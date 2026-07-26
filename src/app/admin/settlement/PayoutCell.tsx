'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { markPaidOut } from './actions'

/**
 * 「已打款」标记。
 *
 * executeSettlement 只锁定应付金额,真实转账是财务在系统外做的 ——
 * 此前系统里没有任何「打没打」的记录,对不上账只能翻聊天记录。
 */
export function PayoutCell({
  month,
  delivererId,
  payoutCents,
  orderCount,
  paidOutAt,
  note,
}: {
  month: string
  delivererId: string
  payoutCents: number
  orderCount: number
  paidOutAt: string | null
  note: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [noteInput, setNoteInput] = useState(note ?? '')
  const [error, setError] = useState<string | null>(null)

  const submit = (paid: boolean) => {
    setError(null)
    startTransition(async () => {
      try {
        const r = await markPaidOut({
          month,
          delivererId,
          payoutCents,
          orderCount,
          note: noteInput,
          paid,
        })
        if (!r.ok) {
          setError(r.error)
          return
        }
        setEditing(false)
        router.refresh()
      } catch {
        setError('操作失败(可能没有超管权限)')
      }
    })
  }

  if (paidOutAt) {
    return (
      <div className="text-right text-xs">
        <span className="rounded bg-green-50 px-1.5 py-0.5 text-green-800">已打款</span>
        <p className="mt-0.5 text-ink-400">{paidOutAt.slice(0, 10)}</p>
        {note && <p className="mt-0.5 text-ink-400">{note}</p>}
        <button
          disabled={pending}
          onClick={() => submit(false)}
          className="mt-0.5 text-ink-400 underline hover:text-ink-700 disabled:opacity-50"
        >
          撤销
        </button>
        {error && <p className="mt-0.5 text-red-600">{error}</p>}
      </div>
    )
  }

  if (!editing) {
    return (
      <div className="text-right">
        <button
          onClick={() => setEditing(true)}
          className="rounded border border-ink-200 px-2 py-0.5 text-xs text-ink-600 hover:bg-ink-50"
        >
          标记已打款
        </button>
      </div>
    )
  }

  return (
    <div className="text-right text-xs">
      <input
        value={noteInput}
        onChange={(e) => setNoteInput(e.target.value)}
        placeholder="流水号/备注(选填)"
        className="w-32 rounded border border-ink-200 px-1.5 py-1"
      />
      <div className="mt-1 flex justify-end gap-1">
        <button
          disabled={pending}
          onClick={() => submit(true)}
          className="rounded bg-brand-600 px-2 py-0.5 text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {pending ? '…' : '确认'}
        </button>
        <button
          onClick={() => setEditing(false)}
          className="rounded border border-ink-200 px-2 py-0.5 text-ink-600"
        >
          取消
        </button>
      </div>
      {error && <p className="mt-0.5 text-red-600">{error}</p>}
    </div>
  )
}
