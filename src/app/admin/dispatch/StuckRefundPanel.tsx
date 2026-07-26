'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { resolveStuckRefund } from './actions'

/**
 * 卡在「退款中」的订单的处理面板。
 *
 * 这类订单此前没有任何可操作入口 —— 状态机定义了 refunding → refunded,
 * 但没有 UI 能触发,订单会永久失联。
 */
export function StuckRefundPanel({ orderId }: { orderId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const run = (action: 'retry' | 'revert') => {
    setMsg(null)
    startTransition(async () => {
      try {
        const r = await resolveStuckRefund(orderId, action, note)
        if (!r.ok) {
          setMsg({ kind: 'err', text: r.error })
          return
        }
        setMsg({ kind: 'ok', text: r.note })
        router.refresh()
      } catch {
        setMsg({ kind: 'err', text: '操作失败(可能是没有超管权限),请重试' })
      }
    })
  }

  return (
    <div className="w-full max-w-sm rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <p className="text-xs leading-relaxed text-amber-900">
        这单卡在退款中。先到支付渠道后台核对这笔钱到底退出去没有,再选下面对应的操作。
      </p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="核对结果(必填,会记入日志)"
        className="mt-2 w-full rounded-lg border border-ink-200 px-2.5 py-2 text-sm"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          disabled={pending}
          onClick={() => run('retry')}
          className="min-h-10 flex-1 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {pending ? '处理中…' : '完成退款'}
        </button>
        <button
          disabled={pending}
          onClick={() => run('revert')}
          className="min-h-10 flex-1 rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-700 hover:bg-ink-50 disabled:opacity-60"
        >
          没退成,退回待派单
        </button>
      </div>
      {msg && (
        <p
          className={`mt-2 rounded px-2 py-1.5 text-xs ${
            msg.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
          }`}
        >
          {msg.text}
        </p>
      )}
    </div>
  )
}
