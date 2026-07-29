import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { getCurrentUser } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { formatCents } from '@/lib/utils'
import { confirmMockPayment } from './actions'
import { ConfirmButton } from './ConfirmButton'

/**
 * Mock 支付确认页。
 *
 * 仅在 PAYMENT_PROVIDER=mock 时可达 —— 微信支付商户号到位后,
 * checkoutPlan 会返回真实的微信 Native 二维码链接,不再走这里。
 */

export default async function MockPayPage({
  params,
}: {
  params: Promise<{ outTradeNo: string }>
}) {
  const { outTradeNo } = await params

  // 生产环境未显式开启 ALLOW_MOCK_PAYMENT 时,整个 mock 支付页不可达 ——
  // 与 confirmMockPayment 的服务端守卫一致,避免渲染一个点了会被拒的死按钮
  if (env.isProd && !env.payment.allowMockInProd) notFound()

  /**
   * ⚠️ 页面也必须验归属,不能只在 action 上验。
   *
   *    这一页会把**订单号和金额**渲染出来。只按 outTradeNo 取单的话,
   *    拿到别人的单号就能看到他买了什么、花了多少 —— 而 confirmMockPayment
   *    那边已经补了归属校验,页面这半边漏掉等于修了一半。
   *
   *    用 getCurrentUser 而不是 requireUser:未登录时走 notFound 静默 404,
   *    与「单号不存在」表现一致,不泄露这个单号是否真实。
   */
  const user = await getCurrentUser()
  const payment = await db.payment.findUnique({ where: { outTradeNo } })
  if (!payment || !user || payment.userId !== user.id) notFound()

  if (payment.status === 'succeeded') {
    return (
      <main className="mx-auto max-w-md px-5 py-20 text-center">
        <Card>
          <p className="text-lg font-medium text-ink-900">这笔订单已支付</p>
          <a href="/app/dashboard" className="mt-4 inline-block text-sm text-brand-600 hover:underline">
            去工作台 →
          </a>
        </Card>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-md px-5 py-20">
      <Card>
        <p className="mb-1 text-xs tracking-wide text-ink-400">开发环境模拟支付</p>
        <h1 className="text-xl font-semibold text-ink-900">确认支付</h1>

        <div className="mt-5 space-y-2 border-y border-ink-200 py-4 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-600">订单号</span>
            <span className="font-mono text-xs text-ink-800">{payment.outTradeNo}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-600">金额</span>
            <span className="text-lg font-semibold text-ink-900">
              {formatCents(payment.amountCents)}
            </span>
          </div>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-ink-400">
          微信支付商户号尚未接入,此处为模拟支付。点击下方按钮将直接标记为支付成功,
          不会产生真实扣款。
        </p>

        <div className="mt-5">
          <ConfirmButton outTradeNo={outTradeNo} action={confirmMockPayment} />
        </div>
      </Card>
    </main>
  )
}
