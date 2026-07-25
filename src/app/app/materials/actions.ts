'use server'

import { revalidatePath } from 'next/cache'
import { buildKey, getStorage } from '@/lib/storage'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { track } from '@/lib/analytics'
import { syncApplicationStatuses } from '@/lib/materials/generate'
import type { MaterialStatus } from '@prisma/client'

const MAX_FILE_BYTES = 20 * 1024 * 1024 // 单文件 ≤20MB(PRD 4.4)
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png']

/**
 * 按文件头(magic bytes)判断真实类型。
 *
 * ⚠️ file.type 是浏览器/客户端可任意伪造的,只信它等于没校验 —— 可以把任意二进制
 *    标成 application/pdf 传上来。这里读头几个字节核对真实类型,与声明不符就拒。
 */
function sniffType(buf: Buffer): 'application/pdf' | 'image/jpeg' | 'image/png' | null {
  if (buf.length >= 4 && buf.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return 'image/png'
  }
  return null
}

export async function setMaterialStatus(materialId: string, status: MaterialStatus) {
  const user = await requireUser()
  await db.userMaterial.updateMany({
    where: { id: materialId, userId: user.id },
    data: { status },
  })

  if (status === 'completed') {
    await track('material_done', { userId: user.id, properties: { materialId } })
  }
  await syncApplicationStatuses(user.id)

  revalidatePath('/app/materials')
  revalidatePath('/app/dashboard')
  return { ok: true as const }
}

/**
 * 材料文件上传。
 *
 * ⚠️ 权限(PRD 7.2 / 10.3):学生数据只有本人 + 被授权顾问可见。
 *    这里的 updateMany 带 userId 条件,防止越权改他人材料。
 *
 * ⚠️ 落盘加密与对象存储由存储层(@/lib/storage)负责:local provider 做
 *    AES-256-GCM 落盘加密,oss provider 用存储侧加密 + 签名 URL。这里不碰磁盘。
 */
export async function uploadMaterialFile(materialId: string, formData: FormData) {
  const user = await requireUser()

  const file = formData.get('file')
  if (!(file instanceof File)) return { ok: false as const, error: '没有收到文件' }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false as const, error: '文件超过 20MB,请压缩后重试' }
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { ok: false as const, error: '只支持 PDF / JPG / PNG' }
  }

  const owned = await db.userMaterial.findFirst({
    where: { id: materialId, userId: user.id },
  })
  if (!owned) return { ok: false as const, error: '材料不存在' }

  const bytes = Buffer.from(await file.arrayBuffer())
  // 真实类型必须与声明一致,且落在允许集合内
  const sniffed = sniffType(bytes)
  if (!sniffed || sniffed !== file.type) {
    return { ok: false as const, error: '文件内容与类型不符,只支持真正的 PDF / JPG / PNG' }
  }

  const storage = getStorage()
  const key = buildKey(user.id, materialId, file.name)
  try {
    await storage.put(key, bytes, file.type)
  } catch (err) {
    console.error('[materials] 文件写入失败', err)
    return { ok: false as const, error: '文件保存失败,请稍后重试' }
  }

  await db.userMaterial.update({
    where: { id: materialId },
    data: {
      // 存相对 key,不是 URL —— 取文件走 /api/materials/[id]/file,那里校验归属
      fileUrl: key,
      fileName: file.name,
      fileSize: file.size,
      status: 'completed',
    },
  })

  // 覆盖上传:删掉旧文件,否则换个文件名重传会在存储里留下永久的孤儿密文
  if (owned.fileUrl && owned.fileUrl !== key) {
    try {
      await storage.remove(owned.fileUrl)
    } catch (err) {
      console.error(`[materials] 删除旧文件失败 ${owned.fileUrl}`, err)
    }
  }

  await track('material_done', { userId: user.id, properties: { materialId, uploaded: true } })
  await syncApplicationStatuses(user.id)

  revalidatePath('/app/materials')
  revalidatePath('/app/dashboard')
  return { ok: true as const }
}
