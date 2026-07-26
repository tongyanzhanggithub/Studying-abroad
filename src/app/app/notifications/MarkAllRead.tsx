'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { markAllRead } from './actions'

export function MarkAllRead({ count }: { count: number }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="shrink-0 text-right">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null)
          startTransition(async () => {
            try {
              const r = await markAllRead()
              if (!r.ok) {
                setError('没能标记成功,请重试')
                return
              }
              router.refresh()
            } catch {
              // 弱网下 server action 会失败 —— 说出来,别让按钮一直转
              setError('网络不太稳定,请稍后再试')
            }
          })
        }}
        className="min-h-10 rounded-lg border border-ink-200 px-3 text-sm text-ink-700 transition-colors hover:bg-ink-50 disabled:opacity-60"
      >
        {pending ? '处理中…' : `全部标为已读(${count})`}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
