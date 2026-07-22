import 'server-only'
import { db } from '@/lib/db'
import type { AssessmentInput } from '@/lib/assessment/engine'

/**
 * 把一次评估填的背景同步进持久档案(Profile)。
 *
 * ── 为什么存在 ──────────────────────────────────────────
 * 评估流程本来就问了本科层级/均分/语言/地区/方向,但以前只写进 leads 表,
 * 没进用户档案 —— 结果「设置 → 我的背景」是空的,「按现在资料重算」也用不了,
 * 用户得把同样的东西再填一遍。现在评估填的背景自动落进 Profile,
 * 设置页仍可编辑同一份数据(语言考出来了改一个字段即可,不必重做整份评估)。
 *
 * ⚠️ 不碰 isMajorSwitch —— 那个字段评估里没有,只在设置里填,别覆盖掉。
 */

function toProfileData(input: AssessmentInput) {
  return {
    undergradTier: input.undergradTier,
    undergradMajor: input.undergradMajor,
    gpa: input.gpa,
    gpaScale: input.gpaScale,
    languageType: input.languageType,
    languageScore: input.languageScore ?? null,
    languageMinBand: input.languageMinBand ?? null,
    targetRegions: input.targetRegions,
    targetDirection: input.targetDirection,
  }
}

/**
 * 以这次评估为准写入档案。
 * 用于「已登录状态下提交评估」—— 用户刚亲手填的,直接生效。
 */
export async function saveAssessmentToProfile(
  userId: string,
  input: AssessmentInput,
): Promise<void> {
  const data = toProfileData(input)
  await db.profile.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  })
}

/**
 * 从该手机号最近一次评估回填档案 —— 但只在档案还没填过时(不覆盖用户手填的)。
 *
 * 用于「先做评估、后注册登录」这条最常见的路径:注册时把之前评估的背景补进来,
 * 用户一进来「我的背景」就是满的,而不是让他再填一遍。
 */
export async function backfillProfileFromLatestLead(
  userId: string,
  phone: string,
): Promise<void> {
  const profile = await db.profile.findUnique({ where: { userId } })
  // 已经有本科层级 = 用户自己填过了,尊重它,不回填
  if (profile?.undergradTier) return

  const lead = await db.lead.findFirst({
    where: { phone },
    orderBy: { createdAt: 'desc' },
    select: { assessPayload: true },
  })
  if (!lead?.assessPayload) return

  // assessPayload 就是当初的 AssessmentInput,原样存进去的
  const input = lead.assessPayload as unknown as AssessmentInput
  if (!input?.undergradTier) return

  await saveAssessmentToProfile(userId, input)
}
