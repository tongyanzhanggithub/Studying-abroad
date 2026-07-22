'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { track } from '@/lib/analytics'
import { runAssessment, isDifficultCase, type AssessmentInput } from '@/lib/assessment/engine'
import { isValidPhone } from '@/lib/auth/verification'
import { DIRECTION_ORDER } from '@/lib/programs/types'
import { getPublicRegions } from '@/lib/regions/gate'
import { getSession } from '@/lib/auth/session'
import { saveAssessmentToProfile } from '@/lib/profile/from-assessment'

/**
 * 免费评估提交(PRD 4.1)。
 *
 * 留资逻辑:手机号 + 评估数据全部入库(leads 表),供未付费用户跟进。
 * ⚠️ 合规(PRD 10.3):收集手机号必须明示用途 —— 表单上已写明,
 *    此处不额外向第三方共享。
 */

const AssessSchema = z.object({
  undergradTier: z.enum(['c985_211', 'double_non_first', 'tier_two_other', 'overseas']),
  undergradMajor: z.string().min(1),
  gpa: z.number().min(0).max(100),
  gpaScale: z.enum(['100', '4.0']),
  languageType: z.enum(['ielts', 'toefl', 'none']),
  /**
   * 选「还没考」时客户端不会设这个字段,传过来是 undefined。
   * 只写 .nullable() 会因此报 Required 并卡死整个提交 —— 必须同时 optional。
   */
  languageScore: z.number().nullable().optional().default(null),
  /** 最低单项(雅思小分)。选填 —— 不填就退化成只比总分,不猜。 */
  languageMinBand: z.number().nullable().optional().default(null),
  targetRegions: z
    .array(
      z.enum([
        'UK', 'HK', 'SG', 'AU', 'CA', 'MO',
        'JP', 'KR', 'NZ', 'IE', 'NL', 'DE', 'FR', 'CH',
      ]),
    )
    .min(1),
  targetDirection: z.enum(DIRECTION_ORDER),
  phone: z.string().refine(isValidPhone, '手机号格式不正确'),
  sourceChannel: z.string().nullable().optional(),
  /** 分享裂变:从谁的分享链接进来的(PRD 9) */
  referralCode: z.string().nullable().optional(),
  agreedPrivacy: z.literal(true, {
    errorMap: () => ({ message: '需要先同意隐私政策才能提交' }),
  }),
})

export type AssessFormInput = z.input<typeof AssessSchema>

const FALLBACK_REGIONS = [
  { region: 'UK', count: 139 },
  { region: 'AU', count: 78 },
  { region: 'HK', count: 51 },
  { region: 'SG', count: 34 },
  { region: 'CA', count: 49 },
  { region: 'NZ', count: 22 },
  { region: 'IE', count: 26 },
  { region: 'NL', count: 38 },
  { region: 'DE', count: 35 },
  { region: 'JP', count: 18 },
  { region: 'KR', count: 16 },
  { region: 'MO', count: 10 },
  { region: 'FR', count: 28 },
  { region: 'CH', count: 22 },
]

export async function submitAssessment(raw: unknown) {
  const parsed = AssessSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    // Zod 默认信息是英文(如 "Required"),对用户没有意义。
    // 定制过中文信息的直接用,否则退回到带字段名的通用提示。
    const isDefaultEnglish = /^(Required|Invalid|Expected)/.test(issue?.message ?? '')
    console.warn('[assess] 表单校验未通过', parsed.error.issues)
    return {
      ok: false as const,
      error:
        issue && !isDefaultEnglish
          ? issue.message
          : `有必填项没填完${issue?.path.length ? `(${issue.path.join('.')})` : ''},请检查后重试`,
    }
  }

  const {
    phone,
    sourceChannel,
    referralCode,
    agreedPrivacy: _agreed,
    ...rest
  } = parsed.data
  const input: AssessmentInput = rest

  const result = await runAssessment(input)

  // 分享归因:找到分享者。自己分享给自己不算(同手机号)。
  const referrer = referralCode
    ? await db.lead.findUnique({ where: { shareCode: referralCode } })
    : null
  const validReferrer = referrer && referrer.phone !== phone ? referrer : null

  const lead = await db.lead.create({
    data: {
      phone,
      assessPayload: input as object,
      assessResult: result as unknown as object,
      sourceChannel: sourceChannel ?? null,
      referredById: validReferrer?.id ?? null,
    },
  })

  if (validReferrer) {
    // 分享者的解锁进度 +1(PRD 9:被分享者完成评估后,分享者解锁附加院校)
    await db.lead.update({
      where: { id: validReferrer.id },
      data: { referralCount: { increment: 1 } },
    })
    await track('assess_share_converted', {
      properties: { referrerLeadId: validReferrer.id, newLeadId: lead.id },
    })
  }

  /**
   * 已登录用户做评估 → 顺手把这次背景存进档案(设置页那份数据)。
   * ⚠️ 只在「登录手机号 == 提交手机号」时写,防止有人登录后拿别人手机号
   *    做评估、把自己档案冲掉(或反过来)。未登录提交走登录时回填那条路。
   */
  const session = await getSession()
  if (session && session.phone === phone) {
    await saveAssessmentToProfile(session.userId, input)
  }

  await track('assess_complete', {
    sourceChannel: sourceChannel ?? null,
    properties: {
      leadId: lead.id,
      regions: input.targetRegions,
      direction: input.targetDirection,
      matched: result.totalMatched,
      difficultCase: isDifficultCase(input),
      referred: !!validReferrer,
    },
  })

  return { ok: true as const, leadId: lead.id, result }
}

export async function trackAssessStart(sourceChannel?: string | null) {
  await track('assess_start', { sourceChannel: sourceChannel ?? null })
}

/**
 * 表单可选的地区 + 各自的项目数。
 *
 * ⚠️ 两层过滤,缺一不可:
 *   1. **已开放**(RegionSetting.isPublic)—— 数据核对率不达标的地区不放出来
 *   2. **真有数据** —— 枚举里加了国家不等于有项目
 *
 * 让用户选一个空目的地、或者选一个全是「待核实」数据的目的地,
 * 再告诉他结果不可靠,都是很糟糕的体验。
 */
export async function getAvailableRegions() {
  try {
    const publicRegions = await getPublicRegions()
    if (publicRegions.length === 0) return []

    const groups = await db.program.groupBy({
      by: ['region'],
      where: { active: true, region: { in: publicRegions } },
      _count: true,
    })
    return groups.map((g) => ({ region: g.region as string, count: g._count }))
  } catch (error) {
    console.warn('[assess] 使用地区兜底数据,数据库暂不可用', error)
    return FALLBACK_REGIONS
  }
}
