'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { track } from '@/lib/analytics'
import { runAssessment, isDifficultCase, type AssessmentInput } from '@/lib/assessment/engine'
import { isValidPhone } from '@/lib/auth/verification'
import { DIRECTION_ORDER, REGION_ORDER } from '@/lib/programs/types'
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

export interface RegionOption {
  region: string
  count: number
  /** 已开放且有数据,才可选。false = 前端标「即将开放」并禁用 */
  available: boolean
}

/**
 * 表单地区选项 —— **列出全部支持的英语授课目的地(美国之外)**,
 * 每个带项目数和是否可选。
 *
 * ⚠️ 「全部列出来」和「不让用户选到空地区」两者都要:
 *    - 未开放 / 无数据的地区**照样显示**(让用户看到完整版图),
 *      但 available=false,前端禁用并标「即将开放」。
 *    - 只有 已开放(RegionSetting.isPublic)且真有项目 的才可选。
 *
 *    可选性由 available 表达,而不是靠"从列表里删掉" —— 删掉的话
 *    用户根本不知道我们还覆盖哪些国家;但让他选一个空目的地、
 *    再回一句"没有匹配结果",同样是糟糕体验。两难之间用禁用态化解。
 */
export async function getAvailableRegions(): Promise<RegionOption[]> {
  try {
    const publicRegions = await getPublicRegions()
    const publicSet = new Set(publicRegions)

    const groups = await db.program.groupBy({
      by: ['region'],
      where: { active: true },
      _count: true,
    })
    const countByRegion = new Map(groups.map((g) => [g.region as string, g._count]))

    // 按 REGION_ORDER 输出全部地区,可选的排前面
    return [...REGION_ORDER]
      .map((region) => {
        const count = countByRegion.get(region) ?? 0
        return { region, count, available: publicSet.has(region) && count > 0 }
      })
      .sort((a, b) => Number(b.available) - Number(a.available))
  } catch (error) {
    console.warn('[assess] 使用地区兜底数据,数据库暂不可用', error)
    // 兜底:全部标为不可选,避免在数据库不可用时误开
    return [...REGION_ORDER].map((region) => ({ region, count: 0, available: false }))
  }
}
