'use server'

import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { requireUser } from '@/lib/auth/session'
import { fulfillPayment } from '@/lib/payment/fulfill'

/**
 * 支付成功后该去哪。
 *
 * ⚠️ 之前一律跳 /app/dashboard,而 onboarding 只在「新手机号首次登录」时才会进
 *    (见 src/app/login/page.tsx)。典型路径是:免费评估时留了手机号 → 已经算老用户
 *    → 付款 → 落在一个四个指标全是 0 的空白总览页。
 *
 *    用户刚花了一两千块,第一眼看到的是四个 0 和一句「还没有选校」——
 *    这是整条漏斗里最贵的一段,不该浪费在这里。
 *
 * 判断依据是「选校单是不是空的」,不是「是不是新用户」:
 * 真正决定该不该引导的是有没有东西可看,和注册时间无关。
 */
async function landingFor(userId: string, orderType: string): Promise<string> {
  // 加购单点服务的人早就在用系统了,不该被拉去走引导
  if (orderType !== 'subscription') return '/app/orders'

  const choices = await db.userSchoolChoice.count({ where: { userId } })
  return choices === 0 ? '/app/onboarding' : '/app/dashboard'
}

/**
 * Mock 支付确认。仅开发环境可用。
 * 真实微信支付走 /api/payment/wechat/notify 回调,逻辑复用同一个 fulfillPayment。
 */
export async function confirmMockPayment(outTradeNo: string) {
  /**
   * ⚠️ 生产环境默认拒绝 mock 支付确认。
   *    这是一个能直接完成履约(开季票 / 订单转 paid)的动作,却只校验了
   *    channel === 'mock',没有任何生产护栏。任何人拿到自己订单的 outTradeNo
   *    访问 /pay/mock 点一下就能零元购。演示部署要走通付款流程时,才显式设
   *    ALLOW_MOCK_PAYMENT=true 放行。与 dev 自检路由生产 404 是同一套思路。
   */
  if (env.isProd && !env.payment.allowMockInProd) {
    return { ok: false as const, error: '模拟支付在当前环境不可用' }
  }

  /**
   * ⚠️ 必须校验归属,而且必须要求登录。
   *
   *    这个 action 原来只按 outTradeNo 取单,不问调用者是谁 —— 连登录都不用。
   *    生产环境有 ALLOW_MOCK_PAYMENT 拦着,但**演示部署恰恰会把它打开**,
   *    而那正是外部人员能访问到的环境。届时任何人拿到或猜到一个 outTradeNo
   *    就能触发履约。outTradeNo 带随机段、不易枚举,但「不易枚举」是运气,
   *    不是访问控制 —— 归属校验才是。
   */
  const user = await requireUser()

  const payment = await db.payment.findUnique({ where: { outTradeNo } })
  if (!payment) return { ok: false as const, error: '订单不存在' }
  if (payment.userId !== user.id) {
    // 措辞和「不存在」保持一致,不告诉对方这个单号真实存在
    return { ok: false as const, error: '订单不存在' }
  }
  if (payment.channel !== 'mock') {
    return { ok: false as const, error: '该订单不是模拟支付订单' }
  }

  // 重复点击:已支付的直接按落点跳走,不再履约一次
  if (payment.status === 'succeeded') {
    return {
      ok: true as const,
      redirectTo: await landingFor(payment.userId, payment.orderType),
    }
  }

  await fulfillPayment({
    outTradeNo,
    transactionId: `MOCKTXN${Date.now()}`,
    amountCents: payment.amountCents,
  })

  return {
    ok: true as const,
    redirectTo: await landingFor(payment.userId, payment.orderType),
  }
}
