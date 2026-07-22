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

  const key = buildKey(user.id, materialId, file.name)
  try {
    await getStorage().put(key, Buffer.from(await file.arrayBuffer()), file.type)
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

  await track('material_done', { userId: user.id, properties: { materialId, uploaded: true } })
  await syncApplicationStatuses(user.id)

  revalidatePath('/app/materials')
  revalidatePath('/app/dashboard')
  return { ok: true as const }
}
