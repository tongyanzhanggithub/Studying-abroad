import 'server-only'
import { env } from '@/lib/env'
import type { StorageProvider } from './types'
import { LocalStorageProvider } from './local'
import { OssStorageProvider } from './oss'

/**
 * 可插拔的文件存储。
 *
 * 学生上传的是护照、身份证、学位证扫描件 —— 个人敏感信息。存储层有两个硬要求:
 *   1. **落盘即加密**:拿到磁盘/备份文件的人,不能直接看到明文材料。
 *   2. **访问要能收口**:取文件永远先过 /api/materials/[id]/file 的归属校验,
 *      对象存储侧走**带过期时间的签名 URL**,绝不用公共读。
 *
 * 本地(local)provider 自己做 AES-256-GCM 落盘加密;OSS provider 用存储侧加密 +
 * 签名 URL。业务代码只认这个接口,换 provider 时上传/下载逻辑零改动 ——
 * 控制台建好加密桶、填好 RAM 子账号的 key,把 STORAGE_PROVIDER 切成 oss 即可。
 */
export type { StorageProvider } from './types'

/**
 * userId + materialId + 原始文件名 → 存储 key。
 *
 * ⚠️ key 里带 userId 只是为了归类,**不是**访问控制 —— 真正的门是
 *    /api/materials/[id]/file 的归属校验。别把 key 当 URL 直接发出去。
 *    文件名里的特殊字符全部替换,避免变成路径分隔符或注入点。
 */
export function buildKey(userId: string, materialId: string, originalName: string): string {
  const safe = originalName.replace(/[^\w.\-一-龥]/g, '_').slice(-80)
  return `${userId}/${materialId}-${safe}`
}

let cached: StorageProvider | null = null

export function getStorage(): StorageProvider {
  if (cached) return cached
  // OssStorageProvider 本身不在顶层碰 ali-oss(依赖在 getClient 里动态 import),
  // 所以静态引入它不会让本地环境被迫安装 ali-oss。
  cached =
    env.storage.provider === 'oss' ? new OssStorageProvider() : new LocalStorageProvider()
  return cached
}
