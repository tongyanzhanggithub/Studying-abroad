'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { formatCents } from '@/lib/utils'
import { settleMonth } from './actions'

export function SettleButton({
  month,
  orderCount,
}: {
  month: string
  orderCount: number
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState<{ orderCount: number; totalPayoutCents: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (done) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
        已完成 {month} 结算:{done.orderCount} 单,应付合计{' '}
        {formatCents(done.totalPayoutCents)}。请财务按上表线下转账。
      </div>
    )
  }

  if (!confirming) {
    return (
      <Button onClick={() => setConfirming(true)}>确认结算 {month}</Button>
    )
  }

  return (
    <div className="rounded-lg border border-ink-200 p-4">
      <p className="text-sm leading-relaxed text-ink-800">
        将把 {month} 的 <strong>{orderCount}</strong> 笔已确认订单打上结算批次并锁定应付金额。
        锁定后这些订单不会再进入后续批次。
      </p>
      <p className="mt-1 text-xs text-ink-500">
        此操作不会发起付款,但会改变账目状态,请确认金额无误。
      </p>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await settleMonth(month)
              if (!res.ok) setError(res.error)
              else {
                setDone({ orderCount: res.orderCount, totalPayoutCents: res.totalPayoutCents })
                router.refresh()
              }
            })
          }
        >
          {pending ? '结算中…' : '确认'}
        </Button>
        <Button variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
          取消
        </Button>
      </div>
    </div>
  )
}
