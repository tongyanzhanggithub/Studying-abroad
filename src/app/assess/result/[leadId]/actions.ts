'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireUser, getActiveSubscription } from '@/lib/auth/session'
import { runAssessment, type AssessmentInput } from '@/lib/assessment/engine'
import { regenerateMaterials } from '@/lib/materials/generate'
import { publicProgramWhere } from '@/lib/regions/gate'
import type { TierTag } from '@prisma/client'

/**
 * 把评估结果整批导入选校单。
 *
 * 之前评估完只能记下学校名,再去院校库一所一所搜回来 —— 明明系统刚算过,
 * 却要用户手动把结果搬一遍。
 */
export async function importAssessmentToShortlist(leadId: string) {
  const user = await requireUser()

  const sub = await getActiveSubscription(user.id)
  if (!sub) return { ok: false as const, error: '这是季票功能,先购买季票。' }

  const lead = await db.lead.findUnique({ where: { id: leadId } })
  if (!lead) return { ok: false as const, error: '找不到这份评估。' }

  /**
   * ⚠️ 归属校验。leadId 在 URL 里,不校验的话换个 id 就能把**别人的**
   *    评估结果导进自己的选校单 —— 顺带知道了别人的选校倾向。
   *    评估是登录前做的,lead 上不一定有 convertedUserId,所以用手机号比对。
   */
  if (lead.phone !== user.phone) {
    return { ok: false as const, error: '这份评估不属于当前账号。' }
  }

  const result = await runAssessment(lead.assessPayload as unknown as AssessmentInput, {
    full: true,
  })

  const picks: Array<{ programId: string; tier: TierTag }> = [
    ...result.reach.map((m) => ({ programId: m.programId, tier: 'reach' as const })),
    ...result.match.map((m) => ({ programId: m.programId, tier: 'match' as const })),
    ...result.safe.map((m) => ({ programId: m.programId, tier: 'safe' as const })),
  ]
  if (picks.length === 0) return { ok: false as const, error: '这份评估没有匹配到项目。' }

  /**
   * ⚠️ 再过一次地区闸门。评估结果是**当时**算的,如果那之后某个地区被撤下
   *    (数据发现问题),旧结果里的项目不该还能进选校单。
   */
  const allowed = await db.program.findMany({
    where: { ...(await publicProgramWhere()), id: { in: picks.map((p) => p.programId) } },
    select: { id: true },
  })
  const allowedIds = new Set(allowed.map((p) => p.id))

  const existing = await db.userSchoolChoice.findMany({
    where: { userId: user.id },
    select: { programId: true },
  })
  const has = new Set(existing.map((c) => c.programId))

  /**
   * ⚠️ 一次 createMany 写完,不要在循环里逐条 await create。
   *
   *    一份评估能出二三十个项目,原写法就是二三十个串行往返;
   *    更要命的是它们**不在一个事务里** —— 中途任何一条失败(连接被回收、
   *    网络抖动),用户就留下一份导了一半的选校单:有的学校进去了、有的没有,
   *    而且返回的 added 还是个半截数字,没有任何地方会发现这件事。
   *    对一个「点一下把评估结果搬进来」的动作,要么全进要么全不进才说得通。
   *
   *    skipDuplicates 是第二道保险:上面按 has 过滤过一遍,但两次快速点击
   *    会并发跑到这里,两边都读到「不存在」→ 撞 (userId, programId) 唯一约束
   *    → 整个请求 500。交给数据库忽略重复行即可。
   */
  const toCreate = picks.filter((p) => allowedIds.has(p.programId) && !has.has(p.programId))

  const res = await db.userSchoolChoice.createMany({
    data: toCreate.map((p, i) => ({
      userId: user.id,
      programId: p.programId,
      tierTag: p.tier,
      sort: existing.length + i,
    })),
    skipDuplicates: true,
  })
  // 用数据库实际写入的行数,不是 toCreate.length —— skipDuplicates 可能少写几行
  const added = res.count

  await regenerateMaterials(user.id)

  revalidatePath('/app/schools')
  revalidatePath('/app/dashboard')
  revalidatePath('/app/materials')

  return {
    ok: true as const,
    added,
    skipped: picks.length - added,
    dropped: picks.filter((p) => !allowedIds.has(p.programId)).length,
  }
}
