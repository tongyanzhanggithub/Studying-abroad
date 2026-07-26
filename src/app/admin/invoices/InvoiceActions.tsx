'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { resolveInvoice } from './actions'

export function InvoiceActions({ id }: { id: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const run = (outcome: 'issued' | 'rejected') => {
    setError(null)
    startTransition(async () => {
      try {
        const r = await resolveInvoice(id, outcome, note)
        if (!r.ok) {
          setError(r.error)
          return
        }
        router.refresh()
      } catch {
        setError('操作失败,请重试')
      }
    })
  }

  return (
    <div className="rounded-lg border border-ink-200 p-3">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="发票号码 / 或无法开具的原因"
        className="min-h-10 w-full rounded-lg border border-ink-200 px-2.5 text-sm"
      />
      <div className="mt-2 flex gap-2">
        <button
          disabled={pending}
          onClick={() => run('issued')}
          className="min-h-10 flex-1 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {pending ? '…' : '已开具'}
        </button>
        <button
          disabled={pending}
          onClick={() => run('rejected')}
          className="min-h-10 rounded-lg border border-ink-200 px-3 text-sm text-ink-700 hover:bg-ink-50 disabled:opacity-60"
        >
          无法开具
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  )
}
