'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import {
  executeRefund,
  calcServiceRefund,
  calcSubscriptionRefund,
} from '@/lib/payment'

/**
 * 学生确认验收(PRD 5.3)。
 * 主动确认后立即进入可结算状态,不用等 48h。
 */
export async function confirmDelivery(orderId: string) {
  const user = await requireUser()

  const res = await db.serviceOrder.updateMany({
    // 带 status 条件 —— 防止重复点击或与自动确认任务竞态
    where: { id: orderId, userId: user.id, status: 'delivered' },
    data: { status: 'confirmed', confirmedAt: new Date(), autoConfirmed: false },
  })
  if (res.count === 0) {
    return { ok: false as const, error: '该订单当前不可确认(可能已确认或状态已变更)' }
  }

  revalidatePath('/app/orders')
  return { ok: true as const }
}

/**
 * 学生对交付提出异议(PRD 5.3)。
 *
 * ⚠️ 进入 disputed 后**不会**被 48h 自动确认 ——
 *    学生说有问题,系统就不能替他点头。必须运营介入。
 */
export async function disputeDelivery(orderId: string, reason: string) {
  const user = await requireUser()

  if (!reason.trim()) {
    return { ok: false as const, error: '请简单说明问题,方便我们跟进' }
  }

  const res = await db.serviceOrder.updateMany({
    where: { id: orderId, userId: user.id, status: { in: ['delivered', 'delivering'] } },
    data: {
      status: 'disputed',
      disputedAt: new Date(),
      disputeReason: reason.trim().slice(0, 1000),
    },
  })
  if (res.count === 0) {
    return { ok: false as const, error: '该订单当前不可提交异议' }
  }

  revalidatePath('/app/orders')
  return { ok: true as const }
}

/**
 * 用户自助退款。
 *
 * ⚠️ 退款金额由服务端根据 PRD 4.8 规则重新计算,**不信任前端传来的金额**。
 */
export async function requestRefund(kind: 'subscription' | 'service', id: string) {
  const user = await requireUser()

  if (kind === 'subscription') {
    const sub = await db.subscription.findFirst({
      where: { id, userId: user.id },
      include: { plan: true },
    })
    if (!sub || !sub.paidAt) return { ok: false as const, error: '订单不存在或未支付' }
    if (sub.status !== 'active') return { ok: false as const, error: '该订阅当前不可退款' }

    const decision = calcSubscriptionRefund({
      amountCents: sub.plan.priceCents,
      paidAt: sub.paidAt,
      expiresAt: sub.expiresAt,
    })
    if (!decision.allowed) return { ok: false as const, error: decision.reason }

    const payment = await db.payment.findFirst({
      where: { orderType: 'subscription', orderId: sub.id, status: 'succeeded' },
    })
    if (!payment) return { ok: false as const, error: '找不到对应的支付记录' }

    /**
     * ⚠️ 原子抢锁:active → refunded(SubscriptionStatus 没有 refunding 中间态,直接置终态)。
     *    并发/重复点击只有一个能把 active 抢到手,其余 count===0 提前返回,不会各退一次。
     *    真正的资金幂等由 executeRefund 里的 Payment 状态锁 + outRefundNo 兜底。
     */
    const claimed = await db.subscription.updateMany({
      where: { id: sub.id, userId: user.id, status: 'active' },
      data: { status: 'refunded' },
    })
    if (claimed.count === 0) return { ok: false as const, error: '该订阅当前不可退款(可能已在退款中)' }

    const refund = await executeRefund(payment.id, decision.refundableCents, decision.reason)
    if (!refund.ok) {
      // 退款失败 → 状态放回 active
      await db.subscription.updateMany({ where: { id: sub.id, status: 'refunded' }, data: { status: 'active' } })
      return { ok: false as const, error: refund.error }
    }
  } else {
    const order = await db.serviceOrder.findFirst({ where: { id, userId: user.id } })
    if (!order) return { ok: false as const, error: '订单不存在' }

    const decision = calcServiceRefund({
      amountCents: order.amountCents,
      assignedAt: order.assignedAt,
      deliveredAt: order.deliveredAt,
    })
    if (!decision.allowed) return { ok: false as const, error: decision.reason }

    // ⚠️ 走状态机:可退状态 → refunding(原子抢锁),不再直接 update 到 refunded 绕过状态机
    const claimed = await db.serviceOrder.updateMany({
      where: { id: order.id, userId: user.id, status: { in: ['paid', 'assigned', 'delivering'] } },
      data: { status: 'refunding' },
    })
    if (claimed.count === 0) return { ok: false as const, error: '该订单当前不可退款(可能已在处理中)' }

    const payment = await db.payment.findFirst({
      where: { orderType: 'service', orderId: order.id, status: 'succeeded' },
    })
    if (!payment) {
      await db.serviceOrder.updateMany({ where: { id: order.id, status: 'refunding' }, data: { status: order.status } })
      return { ok: false as const, error: '找不到对应的支付记录' }
    }

    const refund = await executeRefund(payment.id, decision.refundableCents, decision.reason)
    if (!refund.ok) {
      await db.serviceOrder.updateMany({ where: { id: order.id, status: 'refunding' }, data: { status: order.status } })
      return { ok: false as const, error: refund.error }
    }
    await db.serviceOrder.updateMany({ where: { id: order.id, status: 'refunding' }, data: { status: 'refunded' } })
  }

  revalidatePath('/app/orders')
  return { ok: true as const }
}
