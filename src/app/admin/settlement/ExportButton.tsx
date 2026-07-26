'use client'

import { useState, useTransition } from 'react'
import { exportSettlement } from './actions'

/** 结算表 CSV 导出 —— 给财务对账用 */
export function ExportButton({ month }: { month: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <span>
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null)
            try {
              const r = await exportSettlement(month)
              if (!r.ok) {
                setError(r.error)
                return
              }
              const blob = new Blob([r.csv], { type: 'text/csv;charset=utf-8' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = r.filename
              a.click()
              URL.revokeObjectURL(url)
            } catch {
              setError('导出失败,请重试')
            }
          })
        }
        className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50 disabled:opacity-60"
      >
        {pending ? '导出中…' : '导出 CSV'}
      </button>
      {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
    </span>
  )
}
