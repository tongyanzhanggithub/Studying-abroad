import 'server-only'
import { db } from '@/lib/db'

/**
 * 增值服务交付闭环(PRD 4.6 / 5.3)。
 *
 *   下单支付 → 派单 → 交付 → 学生验收(48h 无异议自动确认)
 *   → 月底与交付人结算分成
 *
 * ⚠️ 钱的事必须保守:
 *   · 学生提出异议的订单**永不**自动确认,必须运营介入
 *   · 分成金额在结算时锁定写库,不实时计算 ——
 *     否则日后调整分成比例会把历史账一起改掉
 *   · 已结算的订单不可重复结算(settlementMonth 唯一性保证)
 */

/** PRD 5.3:交付后 48 小时无异议自动确认 */
export const AUTO_CONFIRM_HOURS = 48

/**
 * 自动确认到期订单。由每日定时任务调用。
 *
 * 只处理 `delivered` 状态 —— `disputed` 的订单会被跳过,
 * 这是刻意的:学生说有问题,系统就不能替他点头。
 */
export async function runAutoConfirm(): Promise<{
  confirmed: number
  skippedDisputed: number
  errors: string[]
}> {
  const cutoff = new Date(Date.now() - AUTO_CONFIRM_HOURS * 3600_000)
  const errors: string[] = []

  const due = await db.serviceOrder.findMany({
    where: {
      status: 'delivered',
      deliveredAt: { lte: cutoff },
    },
    select: { id: true },
  })

  let confirmed = 0
  for (const order of due) {
    try {
      // 带 status 条件更新 —— 防止与学生手动操作、运营改状态发生竞态
      const res = await db.serviceOrder.updateMany({
        where: { id: order.id, status: 'delivered' },
        data: { status: 'confirmed', confirmedAt: new Date(), autoConfirmed: true },
      })
      confirmed += res.count
    } catch (err) {
      errors.push(`订单 ${order.id}:${(err as Error).message}`)
    }
  }

  const skippedDisputed = await db.serviceOrder.count({
    where: { status: 'disputed', deliveredAt: { lte: cutoff } },
  })

  if (errors.length) {
    console.error('[结算] 自动确认存在失败项,需人工处理:', errors)
  }

  return { confirmed, skippedDisputed, errors }
}

export interface SettlementRow {
  delivererId: string
  delivererName: string
  role: string
  wxContact: string | null
  splitRatio: number
  orderCount: number
  grossCents: number
  payoutCents: number
  platformCents: number
}

/** 结算月份格式 YYYY-MM */
export function toSettlementMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * 预览某月的结算明细(不写库)。
 *
 * 口径:该月内**已确认**且**尚未结算**的订单。
 * 用已确认时间而非下单时间划分月份 —— 钱在服务真正交付完成后才算数。
 */
export async function previewSettlement(month: string): Promise<SettlementRow[]> {
  const [year, mon] = month.split('-').map(Number)
  if (!year || !mon) throw new Error(`结算月份格式不对:${month}`)

  const start = new Date(year, mon - 1, 1)
  const end = new Date(year, mon, 1)

  const orders = await db.serviceOrder.findMany({
    where: {
      status: 'confirmed',
      settlementMonth: null,
      confirmedAt: { gte: start, lt: end },
      delivererId: { not: null },
    },
    include: { deliverer: true },
  })

  const byDeliverer = new Map<string, SettlementRow>()

  for (const o of orders) {
    if (!o.deliverer) continue
    // 优先用下单时锁定的分成比例;缺失才回退到交付人当前比例
    const ratio = o.splitRatio ?? o.deliverer.splitRatio
    const payout = Math.round(o.amountCents * ratio)

    const row = byDeliverer.get(o.deliverer.id) ?? {
      delivererId: o.deliverer.id,
      delivererName: o.deliverer.name,
      role: o.deliverer.role,
      wxContact: o.deliverer.wxContact,
      splitRatio: ratio,
      orderCount: 0,
      grossCents: 0,
      payoutCents: 0,
      platformCents: 0,
    }

    row.orderCount += 1
    row.grossCents += o.amountCents
    row.payoutCents += payout
    row.platformCents += o.amountCents - payout
    byDeliverer.set(o.deliverer.id, row)
  }

  return [...byDeliverer.values()].sort((a, b) => b.payoutCents - a.payoutCents)
}

/**
 * 执行结算:把该月已确认订单打上结算批次并锁定应付金额。
 *
 * ⚠️ 幂等:只更新 settlementMonth 为 null 的订单,重复执行不会重复计账。
 * ⚠️ 本函数**不发起真实付款** —— 只是把账算清楚并留痕,
 *    实际打款由财务在结算表外执行(MVP 阶段人工转账)。
 */
export async function executeSettlement(month: string): Promise<{
  orderCount: number
  totalPayoutCents: number
}> {
  const [year, mon] = month.split('-').map(Number)
  const start = new Date(year, mon - 1, 1)
  const end = new Date(year, mon, 1)

  const orders = await db.serviceOrder.findMany({
    where: {
      status: 'confirmed',
      settlementMonth: null,
      confirmedAt: { gte: start, lt: end },
      delivererId: { not: null },
    },
    include: { deliverer: true },
  })

  const now = new Date()
  let totalPayoutCents = 0
  let orderCount = 0

  for (const o of orders) {
    if (!o.deliverer) continue
    const ratio = o.splitRatio ?? o.deliverer.splitRatio
    const payout = Math.round(o.amountCents * ratio)

    const res = await db.serviceOrder.updateMany({
      // settlementMonth 仍为 null 才更新 —— 并发执行时不会重复结算
      where: { id: o.id, settlementMonth: null },
      data: { settlementMonth: month, settledAt: now, payoutCents: payout },
    })

    if (res.count > 0) {
      totalPayoutCents += payout
      orderCount += 1
    }
  }

  return { orderCount, totalPayoutCents }
}
