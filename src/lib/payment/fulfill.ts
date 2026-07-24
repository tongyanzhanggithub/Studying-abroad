import 'server-only'
import { db } from '@/lib/db'
import { track } from '@/lib/analytics'
import { recordPurchase } from '@/lib/recommendation/engine'

/**
 * 支付成功后的履约逻辑。
 *
 * Mock 支付与微信回调共用这一个入口 —— 保证两条路径行为完全一致,
 * 换支付渠道时不会出现「开发环境能开通、生产环境开通不了」这类问题。
 *
 * ⚠️ 幂等:支付渠道会重复投递回调,必须保证多次调用只履约一次。
 * ⚠️ 金额校验:必须比对回调金额与本地订单金额,防篡改。
 */
export async function fulfillPayment(params: {
  outTradeNo: string
  transactionId: string
  amountCents: number
  raw?: unknown
}) {
  const { outTradeNo, transactionId, amountCents, raw } = params

  const payment = await db.payment.findUnique({ where: { outTradeNo } })
  if (!payment) throw new Error(`支付单不存在:${outTradeNo}`)

  // 幂等:已履约过直接返回
  if (payment.status === 'succeeded') return

  if (payment.amountCents !== amountCents) {
    throw new Error(
      `金额不匹配,拒绝履约。本地 ${payment.amountCents} 分,回调 ${amountCents} 分`,
    )
  }

  const now = new Date()

  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'succeeded',
        transactionId,
        paidAt: now,
        rawCallback: (raw ?? {}) as object,
      },
    })

    if (payment.orderType === 'subscription') {
      /**
       * 到期日 = 付款时间 + 套餐时长。
       *
       * ⚠️ 早先这里写死成「次年 10 月 31 日」—— 那是只有一种季票时的权宜写法。
       *    现在月票/季票/年票三种时长并存,写死会让 ¥30 的月票白送一整年。
       *    时长由套餐自己带(Plan.durationMonths),定价改了不用动这段代码。
       *
       * ⚠️ 续费要从**原到期日**往后接,而不是从今天算 ——
       *    否则提前续费的人会白白损失掉剩余天数。
       */
      const sub = await tx.subscription.findUnique({
        where: { id: payment.orderId },
        include: { plan: true },
      })
      if (!sub) throw new Error(`订阅不存在:${payment.orderId}`)

      const base =
        sub.expiresAt && sub.expiresAt > now ? new Date(sub.expiresAt) : new Date(now)
      const expiresAt = new Date(base)
      expiresAt.setMonth(expiresAt.getMonth() + sub.plan.durationMonths)

      await tx.subscription.update({
        where: { id: payment.orderId },
        data: { status: 'active', paidAt: now, expiresAt },
      })
    } else {
      await tx.serviceOrder.update({
        where: { id: payment.orderId },
        data: { status: 'paid', paidAt: now },
      })
    }
  })

  // 埋点与归因放在事务外 —— 失败不应回滚已完成的履约
  if (payment.orderType === 'subscription') {
    const sub = await db.subscription.findUnique({
      where: { id: payment.orderId },
      include: { plan: true },
    })
    await track('pay_success', {
      userId: payment.userId,
      properties: { plan: sub?.plan.code, amountCents },
    })
  } else {
    const order = await db.serviceOrder.findUnique({
      where: { id: payment.orderId },
      include: { sku: true },
    })
    await track('service_pay_success', {
      userId: payment.userId,
      properties: { sku: order?.sku.code, amountCents },
    })
    if (order?.fromRuleId) {
      await recordPurchase(payment.userId, order.fromRuleId)
    }
  }
}
