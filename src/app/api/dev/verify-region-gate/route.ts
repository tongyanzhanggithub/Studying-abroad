import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getPublicRegions, getRegionHealth, publicProgramWhere } from '@/lib/regions/gate'
import { env } from '@/lib/env'

/**
 * 地区分批开放闸门自检(仅开发环境)。
 *
 * 与 scripts/verify-region-gate.ts 等价 —— 本地用的 PGlite 每进程只接受一次连接,
 * 独立脚本连不上,放在 Next 进程内可以复用 dev server 已建立的那条连接。
 * 换成真实 Postgres 后直接跑脚本即可,本路由可删。
 *
 * ⚠️ 会临时把一批 program 标记为已核对以模拟达标,**结束时全部还原**,
 *    失败路径也会还原。绝不能把「已核对」污染成假的 —— 那正是这个功能要防的事。
 * ⚠️ 生产环境直接 404。
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  if (request.headers.get('x-cron-secret') !== env.cronSecret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const checks: Array<{ name: string; pass: boolean; detail?: string }> = []
  const check = (name: string, pass: boolean, detail?: string) =>
    checks.push({ name, pass, detail })

  let touched: string[] = []
  let testRegion: string | null = null
  /** 脚本运行前该地区原本的配置,结束时精确还原 */
  let originalSetting: { isPublic: boolean } | null = null

  const restore = async () => {
    if (touched.length) {
      await db.program.updateMany({
        where: { id: { in: touched } },
        data: { confidence: 'ai_collected', lastVerifiedAt: null, verifiedBy: null },
      })
    }
    if (testRegion) {
      if (originalSetting) {
        await db.regionSetting.update({
          where: { region: testRegion as never },
          data: { isPublic: originalSetting.isPublic },
        })
      } else {
        await db.regionSetting.deleteMany({ where: { region: testRegion as never } })
      }
    }
  }

  try {
    const groups = await db.program.groupBy({
      by: ['region'],
      where: { active: true },
      _count: true,
      orderBy: { _count: { region: 'desc' } },
      take: 1,
    })
    if (!groups.length) {
      return NextResponse.json({ error: '库里没有项目,先跑 npm run data:import' }, { status: 400 })
    }
    testRegion = groups[0].region
    const totalInRegion = groups[0]._count

    const existing = await db.regionSetting.findUnique({
      where: { region: testRegion as never },
      select: { isPublic: true },
    })
    originalSetting = existing

    // ── 1. 关闭状态 ────────────────────────────────
    await db.regionSetting.upsert({
      where: { region: testRegion as never },
      create: { region: testRegion as never, isPublic: false },
      update: { isPublic: false },
    })

    const closedRegions = await getPublicRegions()
    check('关闭的地区不出现在开放列表', !closedRegions.includes(testRegion as never))

    const whereClosed = await publicProgramWhere()

    // 不带额外条件时
    const closedTotal = await db.program.count({ where: whereClosed })
    check('全部关闭时用户侧查不到任何项目', closedTotal === 0, `实际 ${closedTotal} 个`)

    /**
     * ⚠️ 这一步专门模拟「调用方自己也传 region」的场景。
     *    早先 publicProgramWhere 把约束放在顶层 region 上,
     *    对象展开会被下面这个 region 直接覆盖 —— 用户传 ?region=JP
     *    就能看到未开放地区的数据。约束必须放在 AND 里才覆盖不掉。
     */
    const closedCount = await db.program.count({
      where: { ...whereClosed, region: testRegion as never },
    })
    check(
      '调用方自传 region 也覆盖不掉闸门',
      closedCount === 0,
      `实际可见 ${closedCount} 个`,
    )

    // ── 2. 未达标 ──────────────────────────────────
    const healthBefore = (await getRegionHealth()).find((h) => h.region === testRegion)
    check('看板能读到该地区健康度', !!healthBefore)
    check(
      '未核对时不达标',
      healthBefore ? !healthBefore.meetsBar : false,
      healthBefore ? `核对率 ${Math.round(healthBefore.verifiedRate * 100)}%` : undefined,
    )

    // ── 3. 模拟达标并开放 ──────────────────────────
    const rate = healthBefore?.minVerifiedRate ?? 0.9
    const need = Math.ceil(totalInRegion * rate)
    const toVerify = await db.program.findMany({
      where: { active: true, region: testRegion as never },
      select: { id: true },
      take: need,
    })
    touched = toVerify.map((p) => p.id)

    await db.program.updateMany({
      where: { id: { in: touched } },
      data: {
        confidence: 'verified',
        lastVerifiedAt: new Date(),
        verifiedBy: 'DEV-SELFCHECK(临时,会还原)',
      },
    })

    const healthAfter = (await getRegionHealth()).find((h) => h.region === testRegion)
    check(
      `标记 ${need} 条已核对后达标`,
      !!healthAfter?.meetsBar,
      healthAfter ? `核对率 ${Math.round(healthAfter.verifiedRate * 100)}%` : undefined,
    )

    await db.regionSetting.update({
      where: { region: testRegion as never },
      data: { isPublic: true, publishedAt: new Date() },
    })

    const openRegions = await getPublicRegions()
    check('开放后进入开放列表', openRegions.includes(testRegion as never))

    const whereOpen = await publicProgramWhere()
    const openCount = await db.program.count({
      where: { ...whereOpen, region: testRegion as never },
    })
    check(
      `开放后 ${totalInRegion} 个项目全部可见`,
      openCount === totalInRegion,
      `实际 ${openCount} 个`,
    )

    // ── 4. 撤下 ────────────────────────────────────
    await db.regionSetting.update({
      where: { region: testRegion as never },
      data: { isPublic: false, publishedAt: null },
    })
    const wherePulled = await publicProgramWhere()
    const pulledCount = await db.program.count({
      where: { ...wherePulled, region: testRegion as never },
    })
    check('撤下后立刻不可见', pulledCount === 0, `实际可见 ${pulledCount} 个`)

    await restore()

    const failed = checks.filter((c) => !c.pass)
    return NextResponse.json(
      {
        testRegion,
        totalInRegion,
        total: checks.length,
        passed: checks.length - failed.length,
        failed: failed.length,
        checks,
        restored: true,
      },
      { status: failed.length ? 500 : 200 },
    )
  } catch (err) {
    await restore().catch(() => {})
    return NextResponse.json(
      { error: (err as Error).message, checks, restored: true },
      { status: 500 },
    )
  }
}
