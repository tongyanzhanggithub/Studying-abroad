import 'server-only'
import { db } from '@/lib/db'
import { REGION_LABEL, REGION_ORDER, VERIFY_STALE_DAYS } from '@/lib/programs/types'
import type { Region } from '@prisma/client'

/**
 * 地区分批开放(PRD 11.3 的可执行版本)。
 *
 * 背景:PRD 规定未核对数据占比 >10% 就该暂停投放。地区一多,
 * 「全部核对完才能上线」等于永远上不了线 —— 310 条数据、11 个地区,
 * 全核对一遍是几十小时的人工。
 *
 * 做法:把闸门下放到地区。哪个地区的数据核对达标了就先开哪个,
 * 其余地区对用户**完全不可见**(不是灰掉,是不出现)。
 *
 * ⚠️ 两条设计原则:
 *   1. **默认关闭**。没有 RegionSetting 记录 = 不开放。新导入一个地区的数据
 *      不会自动对用户可见,必须有人显式点开。
 *   2. **达标 ≠ 自动开放**。达标只是让后台显示「可以开放了」,
 *      真正开放要运营点一下。数据质量的责任不能交给一个阈值。
 */

export interface RegionHealth {
  region: Region
  label: string
  isPublic: boolean
  total: number
  verified: number
  /** 未核对 + 超过 30 天未复核 */
  pending: number
  verifiedRate: number
  minVerifiedRate: number
  minPrograms: number
  /** 是否满足开放门槛(仅是建议,不自动开放) */
  meetsBar: boolean
  /** 距离达标还差多少条核对 */
  verifyGap: number
  /** 距离达标还差多少个项目 */
  programGap: number
  note: string | null
}

/**
 * 当前对用户开放的地区。
 *
 * 所有面向用户的查询都必须经过它 —— 首页、评估表单、院校库、选校。
 * 后台不受限制(运营要能看到还没开放的数据才能核对)。
 */
export async function getPublicRegions(): Promise<Region[]> {
  const settings = await db.regionSetting.findMany({
    where: { isPublic: true },
    select: { region: true },
  })
  return settings.map((s) => s.region)
}

/**
 * 面向用户的 program 查询条件。
 *
 * 用法:`db.program.findMany({ where: { ...(await publicProgramWhere()), region: userPicked } })`
 *
 * ⚠️ 约束**放在 `AND` 里而不是顶层 `region`**,这一点很关键。
 *    早先版本返回 `{ region: { in: publicRegions } }`,结果调用方只要自己也传
 *    `region`(比如选校页的地区筛选),对象展开就会把闸门整个覆盖掉 ——
 *    用户传 `?region=JP` 就能看到尚未开放的日本数据。
 *    放进 AND 后,调用方的 region 与闸门是**并且**关系,覆盖不掉。
 *
 * ⚠️ 没有任何地区开放时返回一个**必然为空**的条件,而不是不加限制 ——
 *    「忘了配置」的后果应该是什么都不显示,而不是把未核对数据全放出去。
 */
export async function publicProgramWhere() {
  const regions = await getPublicRegions()
  return {
    active: true,
    AND: [{ region: { in: regions } }],
  }
}

/** 各地区的数据健康度与开放状态,供后台看板与开放决策使用 */
export async function getRegionHealth(): Promise<RegionHealth[]> {
  const staleBefore = new Date(Date.now() - VERIFY_STALE_DAYS * 86_400_000)

  const [totals, verifieds, settings] = await Promise.all([
    db.program.groupBy({ by: ['region'], where: { active: true }, _count: true }),
    db.program.groupBy({
      by: ['region'],
      where: { active: true, confidence: 'verified', lastVerifiedAt: { gte: staleBefore } },
      _count: true,
    }),
    db.regionSetting.findMany(),
  ])

  const totalBy = new Map(totals.map((t) => [t.region, t._count]))
  const verifiedBy = new Map(verifieds.map((v) => [v.region, v._count]))
  const settingBy = new Map(settings.map((s) => [s.region, s]))

  // 有数据的地区,或已建过配置的地区,都要出现在看板上
  const regions = new Set<Region>([...totalBy.keys(), ...settingBy.keys()])

  const rows = [...regions].map((region) => {
    const total = totalBy.get(region) ?? 0
    const verified = verifiedBy.get(region) ?? 0
    const setting = settingBy.get(region)

    const minVerifiedRate = setting?.minVerifiedRate ?? 0.9
    const minPrograms = setting?.minPrograms ?? 25
    const verifiedRate = total > 0 ? verified / total : 0

    // 达到目标核对率还需要再核对多少条
    const neededVerified = Math.ceil(total * minVerifiedRate)
    const verifyGap = Math.max(0, neededVerified - verified)
    const programGap = Math.max(0, minPrograms - total)

    return {
      region,
      label: REGION_LABEL[region] ?? region,
      isPublic: setting?.isPublic ?? false,
      total,
      verified,
      pending: total - verified,
      verifiedRate,
      minVerifiedRate,
      minPrograms,
      meetsBar: total >= minPrograms && verifiedRate >= minVerifiedRate,
      verifyGap,
      programGap,
      note: setting?.note ?? null,
    }
  })

  // 按申请量顺序排,和用户侧一致
  return rows.sort(
    (a, b) => REGION_ORDER.indexOf(a.region as never) - REGION_ORDER.indexOf(b.region as never),
  )
}
