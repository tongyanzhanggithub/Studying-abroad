'use server'

import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { getPaymentProvider } from '@/lib/payment'
import { recordClick } from '@/lib/recommendation/engine'
import { CURRENT_SEASON } from '@/lib/constants'

/**
 * 下单系统季票。
 * 创建 pending 订阅 + 支付单,返回支付链接。
 */
export async function checkoutPlan(planId: string) {
  const user = await requireUser()

  const plan = await db.plan.findUnique({ where: { id: planId } })
  if (!plan || !plan.active) return { ok: false as const, error: '套餐不存在' }

  const existing = await db.subscription.findFirst({
    where: {
      userId: user.id,
      status: 'active',
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  })
  if (existing) return { ok: false as const, error: '你已有生效中的季票' }

  const subscription = await db.subscription.create({
    data: {
      userId: user.id,
      planId: plan.id,
      season: CURRENT_SEASON,
      status: 'expired', // 支付成功后才置 active
    },
  })

  const payment = await getPaymentProvider().createPayment({
    userId: user.id,
    orderType: 'subscription',
    orderId: subscription.id,
    amountCents: plan.priceCents,
    subject: plan.name,
  })

  return { ok: true as const, payUrl: payment.payUrl }
}

/**
 * 下单增值服务。
 * fromRuleId 用于归因 —— 哪条推荐规则带来的成交(PRD 11 漏斗)。
 */
export async function checkoutService(skuId: string, fromRuleId?: string) {
  const user = await requireUser()

  const sku = await db.serviceSku.findUnique({ where: { id: skuId } })
  if (!sku || !sku.active) return { ok: false as const, error: '服务不存在' }

  if (fromRuleId) await recordClick(user.id, fromRuleId)

  const order = await db.serviceOrder.create({
    data: {
      userId: user.id,
      skuId: sku.id,
      amountCents: sku.priceCents,
      status: 'pending_payment',
      fromRuleId: fromRuleId ?? null,
    },
  })

  const payment = await getPaymentProvider().createPayment({
    userId: user.id,
    orderType: 'service',
    orderId: order.id,
    amountCents: sku.priceCents,
    subject: sku.name,
  })

  return { ok: true as const, payUrl: payment.payUrl }
}
