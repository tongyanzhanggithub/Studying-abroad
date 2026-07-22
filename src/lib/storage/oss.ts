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

let clientPromise: Promise<OssClient> | null = null

async function getClient(): Promise<OssClient> {
  if (clientPromise) return clientPromise
  const { region, bucket, accessKeyId, accessKeySecret, internal } = env.storage.oss
  if (!region || !bucket || !accessKeyId || !accessKeySecret) {
    throw new Error(
      'STORAGE_PROVIDER=oss 但 OSS 配置不完整 —— 需要 OSS_REGION / OSS_BUCKET / ' +
        'OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET(见 .env.example)',
    )
  }

  clientPromise = (async () => {
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
  })()
  return clientPromise
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
    const client = await getClient()
    // 桶是私有的,只有带签名的 URL 能在有效期内访问
    return client.signatureUrl(key, { expires: ttlSeconds })
  }
}
