'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatCents } from '@/lib/utils'
import { requestRefund } from './actions'

export function RefundButton({
  kind,
  id,
  refundableCents,
  reason,
}: {
  kind: 'subscription' | 'service'
  id: string
  refundableCents: number
  reason: string
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!confirming) {
    return (
      <div className="text-right">
        <button
          onClick={() => setConfirming(true)}
          className="text-xs text-ink-400 hover:text-ink-800 hover:underline"
        >
          申请退款
        </button>
        <p className="mt-0.5 max-w-48 text-xs text-ink-400">可退 {formatCents(refundableCents)}</p>
      </div>
    )
  }

  return (
    <div className="max-w-56 rounded-lg border border-ink-200 p-3 text-right">
      <p className="text-xs leading-relaxed text-ink-600">{reason}</p>
      <p className="mt-1 text-sm font-medium text-ink-900">
        退款 {formatCents(refundableCents)}
      </p>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button
          onClick={() => setConfirming(false)}
          className="text-xs text-ink-400 hover:text-ink-800"
        >
          取消
        </button>
        <button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await requestRefund(kind, id)
              if (!res.ok) setError(res.error)
              else router.refresh()
            })
          }
          className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
        >
          {pending ? '处理中…' : '确认退款'}
        </button>
      </div>
    </div>
  )
}
