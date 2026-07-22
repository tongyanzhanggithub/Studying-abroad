'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import {
  getPaymentProvider,
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
      coreModuleUseCount: sub.coreModuleUseCount,
    })
    if (!decision.allowed) return { ok: false as const, error: decision.reason }

    const payment = await db.payment.findFirst({
      where: { orderType: 'subscription', orderId: sub.id, status: 'succeeded' },
    })
    if (!payment) return { ok: false as const, error: '找不到对应的支付记录' }

    await getPaymentProvider().refund(payment.id, decision.refundableCents, decision.reason)
    await db.subscription.update({ where: { id: sub.id }, data: { status: 'refunded' } })
  } else {
    const order = await db.serviceOrder.findFirst({ where: { id, userId: user.id } })
    if (!order) return { ok: false as const, error: '订单不存在' }

    const decision = calcServiceRefund({
      amountCents: order.amountCents,
      assignedAt: order.assignedAt,
      deliveredAt: order.deliveredAt,
    })
    if (!decision.allowed) return { ok: false as const, error: decision.reason }

    const payment = await db.payment.findFirst({
      where: { orderType: 'service', orderId: order.id, status: 'succeeded' },
    })
    if (!payment) return { ok: false as const, error: '找不到对应的支付记录' }

    await getPaymentProvider().refund(payment.id, decision.refundableCents, decision.reason)
    await db.serviceOrder.update({ where: { id: order.id }, data: { status: 'refunded' } })
  }

  revalidatePath('/app/orders')
  return { ok: true as const }
}
