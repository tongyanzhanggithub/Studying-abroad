'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { advisorDeliver, advisorStartWork } from './actions'

const inputCls =
  'w-full rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs outline-none focus:border-brand-500'

export function OrderActions({ orderId, status }: { orderId: string; status: string }) {
  const router = useRouter()
  const [form, setForm] = useState(false)
  const [note, setNote] = useState('')
  const [url, setUrl] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (status === 'assigned') {
    return (
      <div className="space-y-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await advisorStartWork(orderId)
              if (!res.ok) setErr(res.error)
              else router.refresh()
            })
          }
        >
          我已联系学生,开始交付
        </Button>
        {err && <p className="text-xs text-red-700">{err}</p>}
      </div>
    )
  }

  if (status !== 'delivering') return null

  return (
    <div className="space-y-2">
      {!form ? (
        <Button size="sm" onClick={() => setForm(true)}>
          提交交付
        </Button>
      ) : (
        <div className="space-y-2 rounded-lg border border-ink-200 p-2.5">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="交付了什么?如:已完成 60min 视频咨询,选校方案文档已发企业微信群"
            className={inputCls}
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="交付物链接(选填)"
            className={inputCls}
          />
          <p className="text-[11px] leading-relaxed text-ink-400">
            交付说明必填。学生会收到通知并在订单页看到这段话 ——
            写清楚一点,他就不用再来问「到底交付了什么」。
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={pending || !note.trim()}
              onClick={() =>
                startTransition(async () => {
                  setErr(null)
                  const res = await advisorDeliver(orderId, note, url)
                  if (!res.ok) {
                    setErr(res.error)
                    return
                  }
                  setForm(false)
                  router.refresh()
                })
              }
            >
              确认已交付
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setForm(false)}>
              取消
            </Button>
          </div>
        </div>
      )}
      {err && <p className="text-xs text-red-700">{err}</p>}
    </div>
  )
}
