'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { track } from '@/lib/analytics'
import { regenerateMaterials, syncApplicationStatuses } from '@/lib/materials/generate'
import type { ApplicationStatus, TierTag } from '@prisma/client'

export async function addToShortlist(programId: string, tierTag: TierTag) {
  const user = await requireUser()

  const existing = await db.userSchoolChoice.findUnique({
    where: { userId_programId: { userId: user.id, programId } },
  })
  if (existing) return { ok: false as const, error: '已经在你的选校单里了' }

  const count = await db.userSchoolChoice.count({ where: { userId: user.id } })
  await db.userSchoolChoice.create({
    data: { userId: user.id, programId, tierTag, sort: count },
  })

  // 选校单变化 → 材料清单重新合并去重
  await regenerateMaterials(user.id)
  await track('school_added', { userId: user.id, properties: { programId, tierTag } })

  revalidatePath('/app/schools')
  revalidatePath('/app/materials')
  revalidatePath('/app/dashboard')
  return { ok: true as const }
}

export async function removeFromShortlist(choiceId: string) {
  const user = await requireUser()
  await db.userSchoolChoice.deleteMany({ where: { id: choiceId, userId: user.id } })
  await regenerateMaterials(user.id)

  revalidatePath('/app/schools')
  revalidatePath('/app/materials')
  revalidatePath('/app/dashboard')
  return { ok: true as const }
}

export async function updateTier(choiceId: string, tierTag: TierTag) {
  const user = await requireUser()
  await db.userSchoolChoice.updateMany({
    where: { id: choiceId, userId: user.id },
    data: { tierTag },
  })
  revalidatePath('/app/schools')
  return { ok: true as const }
}

/**
 * 学生手动改状态。
 * 一旦手动改过就打上 statusManuallySet,之后不再被材料勾选自动覆盖 ——
 * 系统的推断不应该盖掉人的判断。
 */
export async function updateStatus(choiceId: string, status: ApplicationStatus) {
  const user = await requireUser()
  await db.userSchoolChoice.updateMany({
    where: { id: choiceId, userId: user.id },
    data: {
      status,
      statusManuallySet: true,
      submittedAt: status === 'submitted' ? new Date() : undefined,
    },
  })
  await syncApplicationStatuses(user.id)
  revalidatePath('/app/schools')
  revalidatePath('/app/dashboard')
  return { ok: true as const }
}
