'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { confirmDelivery, disputeDelivery } from './actions'

/**
 * 交付验收(PRD 5.3)。
 *
 * 文案上刻意把「有问题」放得和「确认完成」一样显眼 ——
 * 如果只把确认做成大按钮、申诉藏在角落,48h 自动确认就变成了一种诱导。
 */
export function DeliveryActions({
  orderId,
  hoursLeft,
  disputeOnly = false,
}: {
  orderId: string
  /** 距自动确认还剩多少小时;null 表示已过期 */
  hoursLeft: number | null
  /**
   * 只给「有问题」入口,不给「确认完成」。
   *
   * ⚠️ 用于 delivering(交付中)状态:后端 disputeDelivery 本来就接受
   *    delivered / delivering 两种状态,但前端只在 delivered 时渲染按钮 ——
   *    于是「顾问接了单迟迟不交付」这个最常见的投诉场景,学生根本点不到反馈入口。
   *    这种状态下东西还没交付,自然也不该有「确认完成」。
   */
  disputeOnly?: boolean
}) {
  const router = useRouter()
  const [mode, setMode] = useState<'idle' | 'disputing'>('idle')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (mode === 'disputing') {
    return (
      <div className="w-full max-w-sm rounded-lg border border-ink-200 p-3">
        <p className="text-sm font-medium text-ink-900">哪里有问题?</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">
          提交后这一单不会被自动确认,我们会介入处理。
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="比如:交付内容与约定不符、迟迟没有交付、质量达不到预期…"
          className="mt-2 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            disabled={pending || !reason.trim()}
            onClick={() =>
              startTransition(async () => {
                const res = await disputeDelivery(orderId, reason)
                if (!res.ok) setError(res.error)
                else {
                  setMode('idle')
                  router.refresh()
                }
              })
            }
          >
            {pending ? '提交中…' : '提交异议'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode('idle')} disabled={pending}>
            取消
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="text-right">
      <div className="flex flex-wrap justify-end gap-2">
        {!disputeOnly && (
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  const res = await confirmDelivery(orderId)
                  if (!res.ok) setError(res.error)
                  else router.refresh()
                } catch {
                  setError('网络不太稳定,请再试一次')
                }
              })
            }
          >
            确认完成
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => setMode('disputing')}>
          有问题
        </Button>
      </div>
      {hoursLeft !== null && (
        <p className="mt-1.5 text-xs text-ink-400">
          {hoursLeft > 0
            ? `${hoursLeft} 小时后将自动确认`
            : '即将自动确认'}
        </p>
      )}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  )
}
