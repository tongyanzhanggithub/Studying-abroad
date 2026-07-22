'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button, Card } from '@/components/ui'
import { recomputeAssessment } from './actions'

/**
 * 「按我现在的资料重算」。
 *
 * 重点不是算出新名单,是**让用户看见变化** ——
 * 「雅思从 6.5 到 7.0,多开了 11 所」这句话,比一份新名单有说服力得多,
 * 也是唯一能让人知道「继续刷分值不值」的东西。
 */
export function Recompute({ leadId }: { leadId: string }) {
  const router = useRouter()
  const [res, setRes] = useState<{
    leadId: string
    beforeTotal: number
    afterTotal: number
    newlyOpened: string[]
    newCount: number
  } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (res) {
    const delta = res.afterTotal - res.beforeTotal
    return (
      <Card className={delta > 0 ? 'border-safe/40 bg-green-50/50' : ''}>
        <h3 className="font-medium text-ink-900">
          {delta > 0
            ? `按你现在的资料,多开了 ${delta} 个项目`
            : delta < 0
              ? `按你现在的资料,少了 ${-delta} 个项目`
              : '匹配数量没有变化'}
        </h3>
        <p className="mt-1 text-sm text-ink-600">
          {res.beforeTotal} → {res.afterTotal} 个匹配项目。
          {delta < 0 && '(可能是院校数据更新,或某个地区暂时下架了)'}
        </p>

        {res.newCount > 0 && (
          <div className="mt-3">
            <p className="text-sm font-medium text-ink-800">新够得着的:</p>
            <ul className="mt-1 space-y-0.5 text-sm text-ink-600">
              {res.newlyOpened.map((n) => (
                <li key={n}>· {n}</li>
              ))}
              {res.newCount > res.newlyOpened.length && (
                <li className="text-ink-400">…等 {res.newCount} 所</li>
              )}
            </ul>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/assess/result/${res.leadId}`}>
            <Button size="sm">看新方案</Button>
          </Link>
          <Button size="sm" variant="ghost" onClick={() => setRes(null)}>
            收起
          </Button>
        </div>
        <p className="mt-3 text-xs text-ink-400">
          旧的那份没有被覆盖,两份都留着 —— 之后还能对比。
        </p>
      </Card>
    )
  }

  return (
    <div>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setErr(null)
            const r = await recomputeAssessment(leadId)
            if (!r.ok) {
              setErr(r.error)
              return
            }
            setRes(r)
            router.refresh()
          })
        }
      >
        {pending ? '重算中…' : '按我现在的资料重算'}
      </Button>
      {err && <p className="mt-2 text-xs text-red-700">{err}</p>}
    </div>
  )
}
