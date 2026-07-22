import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
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
  const payment = await db.payment.findUnique({ where: { outTradeNo } })
  if (!payment) notFound()

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
