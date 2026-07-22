'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireUser, getActiveSubscription } from '@/lib/auth/session'
import { runAssessment, type AssessmentInput } from '@/lib/assessment/engine'
import type { Region } from '@prisma/client'

/**
 * 按当前资料重算一份评估,并给出与上一份的差异。
 *
 * ⚠️ 不覆盖旧的那份 —— 新建一条。
 *    「我雅思考到 7 分之后多开了几所学校」这件事,只有把前后两份都留着
 *    才说得清楚。覆盖掉等于把用户努力的证据抹了。
 */
export async function recomputeAssessment(baseLeadId: string) {
  const user = await requireUser()

  const sub = await getActiveSubscription(user.id)
  if (!sub) return { ok: false as const, error: '这是季票功能,先购买季票。' }

  const base = await db.lead.findUnique({ where: { id: baseLeadId } })
  if (!base || base.phone !== user.phone) {
    return { ok: false as const, error: '找不到这份评估,或它不属于当前账号。' }
  }

  const profile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!profile || profile.gpa == null || !profile.undergradTier) {
    return {
      ok: false as const,
      // 背景资料已从「设置」搬到本页顶部,提示要跟着改,否则把人支去一个没有表单的页面
      error: '还没填完整的背景资料(本科层级、均分),没法重算。在本页上方「我的背景」里补一下。',
    }
  }

  const old = base.assessPayload as unknown as AssessmentInput

  /**
   * 目标地区和方向沿用上一份 —— 重算的意义是「同样的目标,我现在能开到什么」,
   * 换了目标就不是同一件事的对比了(那应该新建一份方案)。
   */
  const input: AssessmentInput = {
    ...old,
    undergradTier: profile.undergradTier,
    gpa: profile.gpa,
    gpaScale: (profile.gpaScale as '100' | '4.0') ?? old.gpaScale,
    languageType: profile.languageType ?? 'none',
    languageScore: profile.languageScore,
    languageMinBand: profile.languageMinBand,
  }

  const [before, after] = await Promise.all([
    runAssessment(old, { full: true }),
    runAssessment(input, { full: true }),
  ])

  /**
   * ⚠️ 不写 convertedUserId —— 它在 Lead 上是 @unique,一个用户只能占一条。
   *    建第二份方案时会直接撞唯一约束。方案与用户的关联一律走手机号。
   */
  const lead = await db.lead.create({
    data: {
      phone: user.phone,
      assessPayload: input as unknown as object,
      assessResult: (await runAssessment(input)) as unknown as object,
      sourceChannel: 'recompute',
    },
  })

  const beforeIds = new Set(
    [...before.reach, ...before.match, ...before.safe].map((m) => m.programId),
  )
  const afterAll = [...after.reach, ...after.match, ...after.safe]
  const newlyOpened = afterAll.filter((m) => !beforeIds.has(m.programId))

  revalidatePath('/app/assessments')
  return {
    ok: true as const,
    leadId: lead.id,
    beforeTotal: before.totalMatched,
    afterTotal: after.totalMatched,
    newlyOpened: newlyOpened.slice(0, 8).map((m) => `${m.schoolName} ${m.programName}`),
    newCount: newlyOpened.length,
  }
}

/** 新建一份方案(换地区 / 换方向),用于并排对比 */
export async function createAssessmentVariant(input: {
  baseLeadId: string
  targetRegions: string[]
  targetDirection: string
}) {
  const user = await requireUser()

  const sub = await getActiveSubscription(user.id)
  if (!sub) return { ok: false as const, error: '这是季票功能,先购买季票。' }

  const base = await db.lead.findUnique({ where: { id: input.baseLeadId } })
  if (!base || base.phone !== user.phone) {
    return { ok: false as const, error: '找不到这份评估,或它不属于当前账号。' }
  }

  if (input.targetRegions.length === 0) {
    return { ok: false as const, error: '至少选一个地区。' }
  }

  const old = base.assessPayload as unknown as AssessmentInput
  const next: AssessmentInput = {
    ...old,
    targetRegions: input.targetRegions as Region[],
    targetDirection: input.targetDirection as AssessmentInput['targetDirection'],
  }

  const result = await runAssessment(next)
  const lead = await db.lead.create({
    data: {
      phone: user.phone,
      assessPayload: next as unknown as object,
      assessResult: result as unknown as object,
      sourceChannel: 'variant',
    },
  })

  revalidatePath('/app/assessments')
  return { ok: true as const, leadId: lead.id, total: result.totalMatched }
}
