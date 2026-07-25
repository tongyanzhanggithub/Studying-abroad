import 'server-only'
import { env } from '@/lib/env'
import type { StorageProvider } from './types'

/**
 * 阿里云 OSS 存储。
 *
 * ── 为什么这么写 ────────────────────────────────────────
 * `ali-oss` 是可选依赖:本地/演示环境不该被迫安装它。所以这个文件只在
 * STORAGE_PROVIDER=oss 时才被 require(见 storage/index.ts),而 ali-oss 本身
 * 用运行时动态 import 加载 —— 变量形式的模块名让打包器不去静态解析它,
 * 没装也不会让 `next build` 失败。
 *
 * ── 上 OSS 前控制台要配好(见 deploy/云上安全.md P0-4)──────
 *   · 桶权限 = 私有(绝不公共读)
 *   · 服务端加密 = 开启(这里上传时也带了 AES256 头,双保险)
 *   · 用 RAM 子账号的 AccessKey,只授这一个桶的读写
 *   · 应用只存 objectKey,取文件现签**带过期时间的 URL**,URL 不入库
 */

/** 只声明我们真正用到的那几个方法,避免依赖未安装的 @types/ali-oss */
interface OssClient {
  put(key: string, buf: Buffer, opts?: { headers?: Record<string, string> }): Promise<unknown>
  get(key: string): Promise<{ content: Buffer }>
  delete(key: string): Promise<unknown>
  signatureUrl(key: string, opts: { expires: number }): string
}

// 两套 client:主 client 按配置(可能走内网)用于读写;签名 client 强制走公网 endpoint。
let clientPromise: Promise<OssClient> | null = null
let signingClientPromise: Promise<OssClient> | null = null

async function buildClient(internal: boolean): Promise<OssClient> {
  const { region, bucket, accessKeyId, accessKeySecret } = env.storage.oss
  if (!region || !bucket || !accessKeyId || !accessKeySecret) {
    throw new Error(
      'STORAGE_PROVIDER=oss 但 OSS 配置不完整 —— 需要 OSS_REGION / OSS_BUCKET / ' +
        'OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET(见 .env.example)',
    )
  }

  // 变量形式的模块名:打包器无法静态解析 → 没装 ali-oss 也不影响 build
  const moduleName = 'ali-oss'
  let OSS: new (o: unknown) => OssClient
  try {
    const mod = (await import(/* webpackIgnore: true */ moduleName)) as {
      default: new (o: unknown) => OssClient
    }
    OSS = mod.default
  } catch {
    throw new Error('缺少 ali-oss 依赖,请先执行:npm i ali-oss')
  }
  return new OSS({ region, bucket, accessKeyId, accessKeySecret, internal, secure: true })
}

/** 读写用 client —— 按 OSS_INTERNAL 决定是否走内网 endpoint(同区免公网流量费) */
async function getClient(): Promise<OssClient> {
  if (!clientPromise) clientPromise = buildClient(env.storage.oss.internal)
  return clientPromise
}

/**
 * 签名 URL 专用 client —— 永远走**公网** endpoint。
 *
 * ⚠️ 这里踩过一次:开了 OSS_INTERNAL=true(ECS 与 OSS 同区,推荐配置)后,
 *    主 client 的 endpoint 是 xxx-internal.aliyuncs.com。若用它签 URL,签出来的是
 *    内网域名,而 /api/materials/[id]/file 会把这个 URL 302 给**公网浏览器** ——
 *    浏览器根本解析不了内网域名,下载必然失败。所以读写可以走内网省流量,
 *    但签名一定要用公网 endpoint 的 client。internal=false 时两者等价。
 */
async function getSigningClient(): Promise<OssClient> {
  if (!env.storage.oss.internal) return getClient()
  if (!signingClientPromise) signingClientPromise = buildClient(false)
  return signingClientPromise
}

export class OssStorageProvider implements StorageProvider {
  readonly kind = 'oss' as const

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const client = await getClient()
    await client.put(key, bytes, {
      headers: {
        'Content-Type': contentType,
        // 服务端加密:即便桶策略没开,这里也强制单对象加密
        'x-oss-server-side-encryption': 'AES256',
      },
    })
  }

  async get(key: string): Promise<Buffer | null> {
    const client = await getClient()
    try {
      const res = await client.get(key)
      return res.content
    } catch (err) {
      // ali-oss 对象不存在时抛 NoSuchKey;其余错误照常抛出
      if ((err as { code?: string })?.code === 'NoSuchKey') return null
      throw err
    }
  }

  async remove(key: string): Promise<void> {
    const client = await getClient()
    await client.delete(key)
  }

  async signedUrl(key: string, ttlSeconds: number): Promise<string | null> {
    // ⚠️ 用公网 endpoint 的 client 签名,否则 OSS_INTERNAL=true 时签出内网域名,
    //    公网浏览器打不开(详见 getSigningClient 注释)
    const client = await getSigningClient()
    // 桶是私有的,只有带签名的 URL 能在有效期内访问
    return client.signatureUrl(key, { expires: ttlSeconds })
  }
}
