import 'server-only'
import { join, resolve, sep, dirname } from 'node:path'
import { readFile, writeFile, mkdir, stat, unlink } from 'node:fs/promises'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { env } from '@/lib/env'
import type { StorageProvider } from './types'

/**
 * 本地磁盘存储。
 *
 * ⚠️ 数据库里存的是**相对 key**(`<userId>/<文件名>`),不是可访问的 URL。
 *    文件一律通过 /api/materials/[id]/file 取,那里校验归属。
 *
 * ⚠️ **落盘加密**:磁盘上不是原始文件,是 AES-256-GCM 密文。
 *    早先是明文存盘 —— 拿到磁盘或备份文件的人可以直接看学生护照。
 *    现在即便文件被拷走,没有 AUTH_SECRET 也解不开。
 *
 *    诚实说明边界:AUTH_SECRET 就在同一台机器的 .env 里,能登上服务器读文件的人
 *    一样能解开。它防的是「只拿到磁盘/备份」的场景。要更强隔离,上 OSS + KMS。
 */

const UPLOAD_ROOT = join(process.cwd(), 'uploads')
const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

function fileKey(): Buffer {
  // AUTH_SECRET 长度不定,用 sha256 归一到 32 字节(与 settings.ts 同一套路)
  return createHash('sha256').update(env.authSecret).digest()
}

/**
 * key → 磁盘绝对路径,并确认没有跑出 uploads 目录。
 *
 * ⚠️ 即便 key 是我们自己生成的,这一步也不能省:数据库字段可写,
 *    一旦别处出现注入,`../../etc/passwd` 就会变成真实的读文件漏洞。
 */
function resolveKey(key: string): string | null {
  const abs = resolve(UPLOAD_ROOT, key)
  const root = resolve(UPLOAD_ROOT)
  if (abs !== root && !abs.startsWith(root + sep)) return null
  return abs
}

/** 明文 → [IV(12) | TAG(16) | 密文] 的单个 Buffer */
function encryptBytes(plain: Buffer): Buffer {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, fileKey(), iv)
  const enc = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), enc])
}

/** [IV | TAG | 密文] → 明文;解不开(密钥换过 / 文件损坏)抛错 */
function decryptBytes(blob: Buffer): Buffer {
  const iv = blob.subarray(0, IV_LEN)
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const data = blob.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv(ALGO, fileKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()])
}

export class LocalStorageProvider implements StorageProvider {
  readonly kind = 'local' as const

  async put(key: string, bytes: Buffer, _contentType: string): Promise<void> {
    const abs = resolveKey(key)
    if (!abs) throw new Error('非法的存储 key')
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, encryptBytes(bytes))
  }

  async get(key: string): Promise<Buffer | null> {
    const abs = resolveKey(key)
    if (!abs) return null
    try {
      await stat(abs)
    } catch {
      return null // 数据库有记录但磁盘上没有(换过机器 / 部署没带上 uploads)
    }
    const blob = await readFile(abs)
    try {
      return decryptBytes(blob)
    } catch {
      /**
       * 解不开 —— 两种情况:
       *   1. 本次加密改造之前上传的旧明文文件(尚未上线,基本只有测试数据)
       *   2. AUTH_SECRET 轮换过,旧文件的密钥对不上
       * 都返回 null,让路由走「文件找不到,请重新上传」的干净提示,
       * 而不是把整个请求 500 掉。
       */
      return null
    }
  }

  async remove(key: string): Promise<void> {
    const abs = resolveKey(key)
    if (!abs) return
    try {
      await unlink(abs)
    } catch {
      // 已经不在了,当作删成功
    }
  }

  async signedUrl(): Promise<string | null> {
    // 本地没有直读 URL —— 由 /api/materials/[id]/file 经应用流式返回
    return null
  }
}
