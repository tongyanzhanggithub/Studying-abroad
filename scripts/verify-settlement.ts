/**
 * 交付闭环与月结分成验证(PRD 4.6 / 5.3)
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/verify-settlement.ts
 *
 * 钱的逻辑必须实测,重点验四件事:
 *   1. 48h 到期的订单会自动确认
 *   2. 有异议的订单**永不**被自动确认
 *   3. 结算金额按下单时锁定的分成比例算,且写库锁定
 *   4. 重复结算不会重复计账(幂等)
 */

import { PrismaClient } from '@prisma/client'
import {
  runAutoConfirm,
  previewSettlement,
  executeSettlement,
  toSettlementMonth,
  AUTO_CONFIRM_HOURS,
} from '../src/lib/services/settlement'

const db = new PrismaClient()
const TAG = 'SETTLE-TEST'

let step = 0
const ok = (m: string) => console.log(`  ${++step}. ✓ ${m}`)

/**
 * 显式标注类型,TS 才会把它当作 assertion function 做控制流收窄 ——
 * 只写 `const fail = (m: string): never => {...}` 不会收窄后续的 undefined。
 */
const fail: (m: string) => never = (m) => {
  console.error(`\n  ✗ ${m}`)
  process.exit(1)
}

async function cleanup() {
  await db.serviceOrder.deleteMany({ where: { user: { phone: { startsWith: '1390009' } } } })
  await db.user.deleteMany({ where: { phone: { startsWith: '1390009' } } })
  await db.deliverer.deleteMany({ where: { name: { startsWith: TAG } } })
}

async function main() {
  console.log('\n交付闭环与月结分成验证\n' + '─'.repeat(48))
  await cleanup()

  const sku = await db.serviceSku.findFirstOrThrow({ where: { code: 'essay_review' } })
  const user = await db.user.create({ data: { phone: '13900090001' } })

  const deliverer = await db.deliverer.create({
    data: { name: `${TAG} 张老师`, role: '文书编辑', splitRatio: 0.65, wxContact: 'zhang_test' },
  })

  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000)

  // ── 1. 到期订单自动确认 ────────────────────────────
  const due = await db.serviceOrder.create({
    data: {
      userId: user.id, skuId: sku.id, delivererId: deliverer.id,
      amountCents: sku.priceCents, splitRatio: 0.65,
      status: 'delivered', paidAt: hoursAgo(96), deliveredAt: hoursAgo(AUTO_CONFIRM_HOURS + 2),
    },
  })

  // 未到期的不该被碰
  const notDue = await db.serviceOrder.create({
    data: {
      userId: user.id, skuId: sku.id, delivererId: deliverer.id,
      amountCents: sku.priceCents, splitRatio: 0.65,
      status: 'delivered', paidAt: hoursAgo(10), deliveredAt: hoursAgo(2),
    },
  })

  // 有异议的绝不能被自动确认
  const disputed = await db.serviceOrder.create({
    data: {
      userId: user.id, skuId: sku.id, delivererId: deliverer.id,
      amountCents: sku.priceCents, splitRatio: 0.65,
      status: 'disputed', paidAt: hoursAgo(96),
      deliveredAt: hoursAgo(AUTO_CONFIRM_HOURS + 5),
      disputedAt: hoursAgo(1), disputeReason: '交付内容与约定不符',
    },
  })

  const r1 = await runAutoConfirm()
  ok(`自动确认执行:确认 ${r1.confirmed} 单,跳过异议单 ${r1.skippedDisputed} 单`)

  const dueAfter = await db.serviceOrder.findUniqueOrThrow({ where: { id: due.id } })
  if (dueAfter.status !== 'confirmed') fail('超过 48h 的订单没有被自动确认')
  if (!dueAfter.autoConfirmed) fail('autoConfirmed 标记没有置位,结算争议时无法区分')
  ok('超 48h 订单已自动确认,并标记为系统确认')

  const notDueAfter = await db.serviceOrder.findUniqueOrThrow({ where: { id: notDue.id } })
  if (notDueAfter.status !== 'delivered') fail('未到 48h 的订单被提前确认了')
  ok('未到期订单未被影响')

  const disputedAfter = await db.serviceOrder.findUniqueOrThrow({ where: { id: disputed.id } })
  if (disputedAfter.status !== 'disputed') {
    fail('⚠️ 严重:有异议的订单被自动确认了 —— 学生说有问题,系统不能替他点头')
  }
  ok('异议订单未被自动确认(关键防线)')

  // ── 2. 结算口径 ────────────────────────────────────
  const month = toSettlementMonth(dueAfter.confirmedAt ?? new Date())

  const preview = await previewSettlement(month)
  const row = preview.find((r) => r.delivererId === deliverer.id)
  if (!row) fail('结算预览里找不到该交付人')

  const expectedPayout = Math.round(sku.priceCents * 0.65)
  if (row.payoutCents !== expectedPayout) {
    fail(`分成算错:期望 ${expectedPayout} 分,实际 ${row.payoutCents} 分`)
  }
  if (row.orderCount !== 1) fail(`只有 1 单已确认,预览却算了 ${row.orderCount} 单`)
  ok(`结算预览正确:1 单,应付 ${(row.payoutCents / 100).toFixed(2)} 元(65%)`)

  if (row.platformCents !== sku.priceCents - expectedPayout) fail('平台留存算错')
  ok('平台留存 = 流水 − 应付,对得上')

  // ── 3. 分成比例变更不应影响历史账 ───────────────────
  await db.deliverer.update({ where: { id: deliverer.id }, data: { splitRatio: 0.5 } })
  const previewAfterRatioChange = await previewSettlement(month)
  const row2 = previewAfterRatioChange.find((r) => r.delivererId === deliverer.id)
  if (row2?.payoutCents !== expectedPayout) {
    fail('改了交付人当前分成比例,历史订单的应付金额跟着变了 —— 应该用下单时锁定的比例')
  }
  ok('调整分成比例后,历史订单金额不变(用下单时锁定的比例)')

  // ── 4. 执行结算 + 幂等 ──────────────────────────────
  const s1 = await executeSettlement(month)
  if (s1.orderCount !== 1) fail(`结算单数不对:${s1.orderCount}`)
  if (s1.totalPayoutCents !== expectedPayout) fail('结算总额不对')
  ok(`执行结算:${s1.orderCount} 单,合计 ${(s1.totalPayoutCents / 100).toFixed(2)} 元`)

  const settled = await db.serviceOrder.findUniqueOrThrow({ where: { id: due.id } })
  if (settled.settlementMonth !== month) fail('结算批次没有写进订单')
  if (settled.payoutCents !== expectedPayout) fail('应付金额没有锁定写库')
  ok('结算批次与应付金额已锁定写库')

  const s2 = await executeSettlement(month)
  if (s2.orderCount !== 0) fail(`⚠️ 严重:重复结算了 ${s2.orderCount} 单,会导致重复付款`)
  ok('重复执行结算不会重复计账(幂等)')

  const previewAfter = await previewSettlement(month)
  if (previewAfter.find((r) => r.delivererId === deliverer.id)) {
    fail('已结算的订单仍出现在待结算预览里')
  }
  ok('已结算订单不再出现在待结算列表')

  console.log('─'.repeat(48))
  console.log(`\n全部 ${step} 项通过。\n`)

  await cleanup()
  console.log('测试数据已清理。')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
