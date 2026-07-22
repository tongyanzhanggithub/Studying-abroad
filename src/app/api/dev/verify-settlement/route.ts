import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  runAutoConfirm,
  previewSettlement,
  executeSettlement,
  toSettlementMonth,
  AUTO_CONFIRM_HOURS,
} from '@/lib/services/settlement'
import { env } from '@/lib/env'

/**
 * 结算逻辑自检(仅开发环境)。
 *
 * 为什么是路由而不是脚本:本地用的 PGlite 每个进程只接受一次客户端连接,
 * 独立脚本连不上;放在 Next 进程内可以复用 dev server 已建立的那条连接。
 * 换成真实 Postgres 后,scripts/verify-settlement.ts 可以直接跑,本路由即可删除。
 *
 * ⚠️ 生产环境直接 404 —— 它会写测试数据,绝不能暴露在线上。
 */

const TAG = 'SETTLE-TEST'
const TEST_PHONE_PREFIX = '1390009'

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

  const cleanup = async () => {
    await db.serviceOrder.deleteMany({
      where: { user: { phone: { startsWith: TEST_PHONE_PREFIX } } },
    })
    await db.user.deleteMany({ where: { phone: { startsWith: TEST_PHONE_PREFIX } } })
    await db.deliverer.deleteMany({ where: { name: { startsWith: TAG } } })
  }

  try {
    await cleanup()

    const sku = await db.serviceSku.findFirstOrThrow({ where: { code: 'essay_review' } })
    const user = await db.user.create({ data: { phone: `${TEST_PHONE_PREFIX}0001` } })
    const deliverer = await db.deliverer.create({
      data: { name: `${TAG} 张老师`, role: '文书编辑', splitRatio: 0.65 },
    })

    const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000)
    const base = {
      userId: user.id,
      skuId: sku.id,
      delivererId: deliverer.id,
      amountCents: sku.priceCents,
      splitRatio: 0.65,
    }

    const due = await db.serviceOrder.create({
      data: {
        ...base, status: 'delivered' as const,
        paidAt: hoursAgo(96), deliveredAt: hoursAgo(AUTO_CONFIRM_HOURS + 2),
      },
    })
    const notDue = await db.serviceOrder.create({
      data: {
        ...base, status: 'delivered' as const,
        paidAt: hoursAgo(10), deliveredAt: hoursAgo(2),
      },
    })
    const disputed = await db.serviceOrder.create({
      data: {
        ...base, status: 'disputed' as const,
        paidAt: hoursAgo(96), deliveredAt: hoursAgo(AUTO_CONFIRM_HOURS + 5),
        disputedAt: hoursAgo(1), disputeReason: '交付内容与约定不符',
      },
    })

    // ── 1. 自动确认 ──────────────────────────────────
    const auto = await runAutoConfirm()

    const dueAfter = await db.serviceOrder.findUniqueOrThrow({ where: { id: due.id } })
    check('超 48h 订单自动确认', dueAfter.status === 'confirmed', `状态 ${dueAfter.status}`)
    check('标记为系统确认(结算争议时可区分)', dueAfter.autoConfirmed)

    const notDueAfter = await db.serviceOrder.findUniqueOrThrow({ where: { id: notDue.id } })
    check('未到 48h 的订单未被提前确认', notDueAfter.status === 'delivered')

    const disputedAfter = await db.serviceOrder.findUniqueOrThrow({ where: { id: disputed.id } })
    check(
      '异议订单永不被自动确认(关键防线)',
      disputedAfter.status === 'disputed',
      `状态 ${disputedAfter.status}`,
    )

    // ── 2. 结算口径 ──────────────────────────────────
    const month = toSettlementMonth(dueAfter.confirmedAt ?? new Date())
    const expectedPayout = Math.round(sku.priceCents * 0.65)

    const preview = await previewSettlement(month)
    const row = preview.find((r) => r.delivererId === deliverer.id)
    check('结算预览能找到该交付人', !!row)
    check('只计入已确认订单(1 单)', row?.orderCount === 1, `实际 ${row?.orderCount}`)
    check(
      `分成按 65% 计算(${(expectedPayout / 100).toFixed(2)} 元)`,
      row?.payoutCents === expectedPayout,
      `实际 ${((row?.payoutCents ?? 0) / 100).toFixed(2)} 元`,
    )
    check(
      '平台留存 = 流水 − 应付',
      row?.platformCents === sku.priceCents - expectedPayout,
    )

    // ── 3. 改分成比例不影响历史账 ──────────────────────
    await db.deliverer.update({ where: { id: deliverer.id }, data: { splitRatio: 0.5 } })
    const afterRatio = (await previewSettlement(month)).find(
      (r) => r.delivererId === deliverer.id,
    )
    check(
      '调整分成比例后历史订单金额不变',
      afterRatio?.payoutCents === expectedPayout,
      `实际 ${((afterRatio?.payoutCents ?? 0) / 100).toFixed(2)} 元`,
    )

    // ── 4. 执行结算 + 幂等 ────────────────────────────
    const s1 = await executeSettlement(month)
    check('执行结算:1 单', s1.orderCount === 1, `实际 ${s1.orderCount}`)
    check('结算总额正确', s1.totalPayoutCents === expectedPayout)

    const settled = await db.serviceOrder.findUniqueOrThrow({ where: { id: due.id } })
    check('结算批次写入订单', settled.settlementMonth === month)
    check('应付金额锁定写库', settled.payoutCents === expectedPayout)

    const s2 = await executeSettlement(month)
    check('重复结算不重复计账(幂等)', s2.orderCount === 0, `重复结算了 ${s2.orderCount} 单`)

    const previewAfter = await previewSettlement(month)
    check(
      '已结算订单不再出现在待结算列表',
      !previewAfter.find((r) => r.delivererId === deliverer.id),
    )

    await cleanup()

    const failed = checks.filter((c) => !c.pass)
    return NextResponse.json(
      {
        total: checks.length,
        passed: checks.length - failed.length,
        failed: failed.length,
        autoConfirmResult: auto,
        checks,
      },
      { status: failed.length ? 500 : 200 },
    )
  } catch (err) {
    await cleanup().catch(() => {})
    return NextResponse.json(
      { error: (err as Error).message, checks },
      { status: 500 },
    )
  }
}
