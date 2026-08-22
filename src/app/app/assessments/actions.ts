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

/**
 * ⚠️ 这里原来还有一个 createAssessmentVariant(换地区 / 换方向新建一份方案)。
 *
 *    它写完了、能跑,但**从来没有任何入口** —— 全项目只有它自己的定义那一行。
 *    而 /app/assessments 顶部当时写着「换个地区或方向再算一次」,
 *    页面中部又把目标做成只读并解释「换了就不是同一件事的对比」。
 *    2026-08-19 定了口径:**这一页不提供换目标**,想比较不同组合就去
 *    /assess 新做一份(列表按手机号查,新做的会自动并排列进来)。
 *
 *    既然决定不提供,就不留一个没有 UI 的 server action 在这里 ——
 *    这个文件是 `'use server'`,而它的其它导出确实在用,所以整个模块会进构建。
 *    留着等于挂一个没人看得见、也没人限流的建库 + 跑评估引擎的入口。
 *    要恢复的话 git 里有:见删除它的那个提交。
 */
