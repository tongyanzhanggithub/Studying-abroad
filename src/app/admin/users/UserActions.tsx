'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui'
import { extendSubscription, resetAiQuota } from './actions'

export function UserActions({
  userId,
  activeSubscriptionId,
  canExtend,
}: {
  userId: string
  activeSubscriptionId: string | null
  canExtend: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [months, setMonths] = useState('1')
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => {
    setMsg(null)
    startTransition(async () => {
      try {
        const r = await fn()
        if (!r.ok) {
          setMsg({ kind: 'err', text: r.error ?? '操作失败' })
          return
        }
        setMsg({ kind: 'ok', text: okText })
        router.refresh()
      } catch {
        setMsg({ kind: 'err', text: '网络不稳定或没有权限,请重试' })
      }
    })
  }

  return (
    <Card>
      <h2 className="text-sm font-medium text-ink-900">客服操作</h2>

      <div className="mt-3 space-y-4">
        {/* 延长 / 补发季票 */}
        <div>
          <p className="text-sm text-ink-700">延长季票有效期</p>
          {!canExtend ? (
            <p className="mt-1 text-xs text-ink-400">
              只有超级管理员能改权益 —— 这等价于发钱,需要可追溯的责任人。
            </p>
          ) : !activeSubscriptionId ? (
            <p className="mt-1 text-xs text-ink-400">
              该用户没有生效中的季票。补发请先让他下单,或在数据库层面处理(暂不支持凭空创建订阅)。
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap items-start gap-2">
              <input
                type="number"
                min={1}
                max={24}
                value={months}
                onChange={(e) => setMonths(e.target.value)}
                className="min-h-11 w-20 rounded-lg border border-ink-200 px-3 text-sm"
                aria-label="延长月数"
              />
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="原因(必填,会记入日志备查)"
                className="min-h-11 min-w-[220px] flex-1 rounded-lg border border-ink-200 px-3 text-sm"
                aria-label="延长原因"
              />
              <button
                disabled={pending}
                onClick={() =>
                  run(
                    () => extendSubscription(activeSubscriptionId, Number(months), reason),
                    `已延长 ${months} 个月`,
                  )
                }
                className="min-h-11 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {pending ? '处理中…' : '延长'}
              </button>
            </div>
          )}
        </div>

        {/* 重置当日 AI 配额 */}
        <div className="border-t border-ink-100 pt-4">
          <p className="text-sm text-ink-700">重置今日 AI 配额</p>
          <p className="mt-1 text-xs text-ink-400">
            模型抽风、白扣了次数时用。只影响今天的计数。
          </p>
          <button
            disabled={pending}
            onClick={() => run(() => resetAiQuota(userId), '已重置今日 AI 配额')}
            className="mt-2 min-h-11 rounded-lg border border-ink-200 px-4 text-sm text-ink-700 hover:bg-ink-50 disabled:opacity-60"
          >
            {pending ? '处理中…' : '重置'}
          </button>
        </div>
      </div>

      {msg && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            msg.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
          }`}
        >
          {msg.text}
        </p>
      )}
    </Card>
  )
}
