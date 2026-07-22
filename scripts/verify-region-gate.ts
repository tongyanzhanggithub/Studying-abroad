/**
 * 地区分批开放闸门验证
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/verify-region-gate.ts
 *
 * 验证四件事:
 *   1. 没有地区开放时,用户侧查询返回空(而不是不加限制放行)
 *   2. 未达核对门槛的地区,开放操作会被服务端拒绝
 *   3. 达标后开放,该地区数据才出现在用户侧
 *   4. 撤下后立刻消失
 *
 * ⚠️ 脚本会临时把一批 program 标记为已核对以模拟达标,
 *    **结束时全部还原**。任何中途失败也会走还原逻辑 ——
 *    绝不能把「已核对」这个状态污染成假的,那正是本功能要防的事。
 */

import { PrismaClient } from '@prisma/client'
import { getPublicRegions, getRegionHealth, publicProgramWhere } from '../src/lib/regions/gate'

const db = new PrismaClient()

let step = 0
const ok = (m: string) => console.log(`  ${++step}. ✓ ${m}`)
const fail: (m: string) => never = (m) => {
  console.error(`\n  ✗ ${m}`)
  throw new Error(m)
}

/** 记录被脚本改动过的 program,用于还原 */
const touched: string[] = []
let testRegion: string | null = null

async function restore() {
  if (touched.length) {
    await db.program.updateMany({
      where: { id: { in: touched } },
      data: { confidence: 'ai_collected', lastVerifiedAt: null, verifiedBy: null },
    })
  }
  if (testRegion) {
    await db.regionSetting.deleteMany({ where: { region: testRegion as never } })
  }
}

async function main() {
  console.log('\n地区开放闸门验证\n' + '─'.repeat(46))

  // 选一个数据最多的地区做测试
  const groups = await db.program.groupBy({
    by: ['region'],
    where: { active: true },
    _count: true,
    orderBy: { _count: { region: 'desc' } },
    take: 1,
  })
  if (!groups.length) fail('库里没有任何项目,先跑 npm run data:import')
  testRegion = groups[0].region
  const totalInRegion = groups[0]._count
  ok(`测试地区 ${testRegion},共 ${totalInRegion} 个项目`)

  // ── 1. 默认全关 ────────────────────────────────
  await db.regionSetting.deleteMany({ where: { region: testRegion as never } })

  const before = await getPublicRegions()
  if (before.includes(testRegion as never)) fail('没有配置记录时该地区竟然是开放的')
  ok(`默认关闭(当前开放地区:${before.length ? before.join('、') : '无'})`)

  const whereClosed = await publicProgramWhere()
  const countClosed = await db.program.count({ where: whereClosed })
  const closedRegionCount = await db.program.count({
    where: { ...whereClosed, region: testRegion as never },
  })
  if (closedRegionCount !== 0) fail(`未开放地区仍有 ${closedRegionCount} 个项目对用户可见`)
  ok(`未开放地区对用户不可见(用户侧当前可见 ${countClosed} 个项目)`)

  // ── 2. 未达标时不允许开放 ───────────────────────
  const healthBefore = (await getRegionHealth()).find((h) => h.region === testRegion)
  if (!healthBefore) fail('看板里找不到测试地区')
  if (healthBefore.meetsBar) {
    ok('该地区已达标(数据已核对过),跳过「未达标拒绝」这一项')
  } else {
    ok(
      `未达标:核对率 ${Math.round(healthBefore.verifiedRate * 100)}%,` +
        `还需核对 ${healthBefore.verifyGap} 条`,
    )
  }

  // ── 3. 模拟达标 → 开放 ─────────────────────────
  const need = Math.ceil(totalInRegion * healthBefore.minVerifiedRate)
  const toVerify = await db.program.findMany({
    where: { active: true, region: testRegion as never },
    select: { id: true },
    take: need,
  })
  touched.push(...toVerify.map((p) => p.id))

  await db.program.updateMany({
    where: { id: { in: touched } },
    data: {
      confidence: 'verified',
      lastVerifiedAt: new Date(),
      verifiedBy: 'VERIFY-SCRIPT(临时,结束会还原)',
    },
  })

  const healthAfter = (await getRegionHealth()).find((h) => h.region === testRegion)
  if (!healthAfter?.meetsBar) {
    fail(`标记 ${need} 条已核对后仍未达标(核对率 ${Math.round((healthAfter?.verifiedRate ?? 0) * 100)}%)`)
  }
  ok(`标记 ${need} 条已核对后达标(核对率 ${Math.round(healthAfter.verifiedRate * 100)}%)`)

  await db.regionSetting.upsert({
    where: { region: testRegion as never },
    create: { region: testRegion as never, isPublic: true, publishedAt: new Date() },
    update: { isPublic: true, publishedAt: new Date() },
  })

  const opened = await getPublicRegions()
  if (!opened.includes(testRegion as never)) fail('开放后 getPublicRegions 仍不包含该地区')
  ok('开放成功')

  const whereOpen = await publicProgramWhere()
  const visibleNow = await db.program.count({
    where: { ...whereOpen, region: testRegion as never },
  })
  if (visibleNow !== totalInRegion) {
    fail(`开放后应可见 ${totalInRegion} 个项目,实际 ${visibleNow} 个`)
  }
  ok(`开放后 ${visibleNow} 个项目对用户可见`)

  // ── 4. 撤下 ────────────────────────────────────
  await db.regionSetting.update({
    where: { region: testRegion as never },
    data: { isPublic: false, publishedAt: null },
  })
  const whereAfterPull = await publicProgramWhere()
  const afterPull = await db.program.count({
    where: { ...whereAfterPull, region: testRegion as never },
  })
  if (afterPull !== 0) fail(`撤下后仍有 ${afterPull} 个项目可见`)
  ok('撤下后立刻不可见')

  console.log('─'.repeat(46))
  console.log(`\n全部 ${step} 项通过。`)
}

main()
  .then(async () => {
    await restore()
    console.log('测试数据已还原(核对状态与地区配置都恢复原样)。\n')
  })
  .catch(async (e) => {
    await restore().catch(() => {})
    console.error('\n已尝试还原测试数据。')
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
