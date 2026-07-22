'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card } from '@/components/ui'
import { discardNotifications, markNotifiedManually } from './actions'

const inputCls =
  'w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500'

export interface QueueRow {
  id: string
  phone: string
  templateCode: string
  channel: string
  title: string
  body: string
  createdAt: string
  isDeadline: boolean
}

export function QueueTable({ rows }: { rows: QueueRow[] }) {
  const router = useRouter()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const toggle = (id: string) =>
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const allSelected = rows.length > 0 && rows.every((r) => sel.has(r.id))

  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSel(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
            />
            选中本页 {rows.length} 条
          </label>
          <span className="text-sm text-ink-500">已选 {sel.size}</span>
        </div>

        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="兜底方式,如:已逐个电话通知 / 已在微信群 @ 到本人"
          className={inputCls}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={pending || sel.size === 0}
            onClick={() =>
              startTransition(async () => {
                const res = await markNotifiedManually([...sel], note)
                setMsg({ kind: 'ok', text: `已记为人工通知 ${res.count} 条。` })
                setSel(new Set())
                setNote('')
                router.refresh()
              })
            }
          >
            标记为「已人工通知」
          </Button>

          <Button
            size="sm"
            variant="ghost"
            disabled={pending || sel.size === 0}
            onClick={() =>
              startTransition(async () => {
                const res = await discardNotifications([...sel], note)
                if (!res.ok) {
                  setMsg({ kind: 'err', text: res.error })
                  return
                }
                setMsg({ kind: 'ok', text: `已作废 ${res.count} 条。` })
                setSel(new Set())
                setNote('')
                router.refresh()
              })
            }
          >
            作废(需填原因)
          </Button>
        </div>

        <p className="text-xs leading-relaxed text-ink-500">
          「已人工通知」是<strong>如实记账</strong>,不是把红色告警划掉。
          真的打了电话、发了微信之后再点 —— 系统没法替你验证这件事。
          只为了让数字归零而点它,积压是消失了,用户还是没收到。
        </p>

        {msg && (
          <p
            className={`rounded-lg px-3 py-2 text-xs ${
              msg.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
            }`}
          >
            {msg.text}
          </p>
        )}
      </Card>

      <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
        {rows.map((r, i) => (
          <div
            key={r.id}
            className={`flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3 ${
              i > 0 ? 'border-t border-ink-100' : ''
            } ${sel.has(r.id) ? 'bg-brand-50/40' : ''} ${r.isDeadline ? 'border-l-2 border-l-red-400' : ''}`}
          >
            <input
              type="checkbox"
              checked={sel.has(r.id)}
              onChange={() => toggle(r.id)}
              className="mt-1 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink-900">{r.phone}</span>
                <span className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600">
                  {r.channel}
                </span>
                {r.isDeadline && (
                  <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">
                    截止提醒 · 优先
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-ink-800">{r.title}</p>
              <p className="text-xs leading-relaxed text-ink-600">{r.body}</p>
            </div>
            <span className="shrink-0 text-xs text-ink-400">{r.createdAt}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
