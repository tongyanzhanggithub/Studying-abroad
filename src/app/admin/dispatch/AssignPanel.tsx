'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { NEXT_ACTIONS } from '@/lib/services/dispatch'
import { assignOrder, resolveDispute, updateOrderStatus } from './actions'
import type { OrderStatus } from '@prisma/client'

const inputCls =
  'w-full rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs outline-none focus:border-brand-500'

export function AssignPanel({
  orderId,
  status,
  currentDelivererId,
  deliverers,
}: {
  orderId: string
  status: OrderStatus
  currentDelivererId: string | null
  deliverers: Array<{ id: string; name: string; role: string }>
}) {
  const router = useRouter()
  const [selected, setSelected] = useState(currentDelivererId ?? '')
  const [assignNote, setAssignNote] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  // 「标记已交付」要先填交付说明,展开成一个小表单
  const [deliverForm, setDeliverForm] = useState(false)
  const [deliveryNote, setDeliveryNote] = useState('')
  const [deliveryUrl, setDeliveryUrl] = useState('')

  // 异议处理
  const [resolution, setResolution] = useState('')

  const actions = NEXT_ACTIONS[status] ?? []
  const canAssign = ['paid', 'assigned', 'delivering'].includes(status)

  const run = (fn: () => Promise<{ ok: boolean; error?: string; note?: string }>) =>
    startTransition(async () => {
      setMsg(null)
      const res = await fn()
      if (!res.ok) {
        setMsg({ kind: 'err', text: res.error ?? '操作失败' })
        return
      }
      if (res.note) setMsg({ kind: 'ok', text: res.note })
      router.refresh()
    })

  return (
    <div className="w-full shrink-0 space-y-2 sm:w-72">
      {canAssign && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="flex-1 rounded-lg border border-ink-200 px-2 py-1.5 text-xs"
            >
              <option value="">选择交付人</option>
              {deliverers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}({d.role})
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={pending || !selected}
              onClick={() =>
                run(async () => {
                  const res = await assignOrder(orderId, selected, assignNote)
                  if (res.ok) {
                    setAssignNote('')
                    return {
                      ok: true,
                      note: res.isReassign
                        ? `已改派给 ${res.delivererName},学生会收到通知。`
                        : `已派给 ${res.delivererName},学生会收到通知。`,
                    }
                  }
                  return res
                })
              }
            >
              {currentDelivererId ? '改派' : '派单'}
            </Button>
          </div>
          {!currentDelivererId && (
            <input
              value={assignNote}
              onChange={(e) => setAssignNote(e.target.value)}
              placeholder="给交付人的说明(选填)"
              className={inputCls}
            />
          )}
        </div>
      )}

      {actions.map((a) =>
        a.to === 'delivered' ? (
          <div key={a.to} className="space-y-2">
            {!deliverForm ? (
              <Button
                size="sm"
                variant="secondary"
                className="w-full"
                onClick={() => setDeliverForm(true)}
              >
                {a.label}
              </Button>
            ) : (
              <div className="space-y-2 rounded-lg border border-ink-200 p-2">
                <textarea
                  value={deliveryNote}
                  onChange={(e) => setDeliveryNote(e.target.value)}
                  rows={2}
                  placeholder="交付了什么?如:已完成 60min 视频咨询,方案文档已发群里"
                  className={inputCls}
                />
                <input
                  value={deliveryUrl}
                  onChange={(e) => setDeliveryUrl(e.target.value)}
                  placeholder="交付物链接(选填)"
                  className={inputCls}
                />
                <p className="text-[11px] leading-relaxed text-ink-400">
                  交付说明必填 —— 服务是线下交付的,出纠纷时这是唯一的依据。
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={pending || !deliveryNote.trim()}
                    onClick={() =>
                      run(async () => {
                        const res = await updateOrderStatus(orderId, 'delivered', {
                          deliveryNote,
                          deliveryUrl,
                        })
                        if (res.ok) {
                          setDeliverForm(false)
                          return { ok: true, note: '已标记交付,学生收到验收通知。' }
                        }
                        return res
                      })
                    }
                  >
                    确认交付
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeliverForm(false)}>
                    取消
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <Button
            key={a.to}
            size="sm"
            variant="secondary"
            className="w-full"
            disabled={pending}
            onClick={() => run(() => updateOrderStatus(orderId, a.to))}
          >
            {a.label}
          </Button>
        ),
      )}

      {status === 'disputed' && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-2">
          <p className="text-[11px] leading-relaxed text-amber-900">
            异议单不会被 48h 自动确认,必须在这里处理掉,否则会一直卡着 ——
            交付人拿不到钱,学生也等不到答复。
          </p>
          <textarea
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            rows={2}
            placeholder="处理结论(必填):和学生沟通了什么、怎么定的"
            className={inputCls}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending || !resolution.trim()}
              onClick={() => run(() => resolveDispute(orderId, 'redo', resolution))}
            >
              退回重做
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || !resolution.trim()}
              onClick={() => run(() => resolveDispute(orderId, 'confirm', resolution))}
            >
              协商后完成
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending || !resolution.trim()}
              onClick={() => run(() => resolveDispute(orderId, 'refund', resolution))}
            >
              转退款
            </Button>
          </div>
        </div>
      )}

      {msg && (
        <p
          className={`rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed ${
            msg.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
          }`}
        >
          {msg.text}
        </p>
      )}
    </div>
  )
}
