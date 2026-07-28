'use server'

import { db } from '@/lib/db'
import { requireUser, getCurrentUser } from '@/lib/auth/session'
import { getPaymentProvider } from '@/lib/payment'
import { recordClick } from '@/lib/recommendation/engine'
import { track } from '@/lib/analytics'
import { CURRENT_SEASON } from '@/lib/constants'

/**
 * 记一次定价页浏览。
 *
 * ⚠️ 为什么不在页面里直接 `await track(...)`(原来的写法):
 *
 *    那是在 RSC **渲染期写数据库**,而渲染在 Next 里根本不等于「一次浏览」:
 *      · 首页那个「价格」链接被 hover 就会预取,预取会跑一遍服务端渲染
 *      · 失败重试、父路由重渲都会再跑一遍
 *
 *    后果有两个。一是**看板数字虚高** ——「定价页浏览」以及由它推出的转化率
 *    直接失真,而 PRD 11.3 是要拿这些数字做决策的。二是**匿名流量的写放大**:
 *    每个从首页划过的人都在往 RDS 里插一行,小规格实例上这是纯浪费。
 *
 *    这和推荐卡 rec_card_shown 是同一类 bug(那边用 30 分钟去重窗压住了)。
 *    这里改成客户端真正挂载后回调一次:预取不会执行 useEffect,
 *    所以只有真人真的打开了这一页才计数 —— 口径反而比原来更准。
 *
 * ⚠️ 这个 action 不鉴权(定价页本来就对匿名开放),所以它**只写这一个事件名、
 *    不接受调用方传入的 properties**。被刷的最坏情况是某个数字变大,
 *    污染不到别的事件,也写不进任意内容。
 */
export async function recordPricingView(usingFallback: boolean) {
  const user = await getCurrentUser()
  await track('pricing_view', {
    userId: user?.id ?? null,
    properties: { usingFallback: Boolean(usingFallback) },
  })
}

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
