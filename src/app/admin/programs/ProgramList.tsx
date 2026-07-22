'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button, Card } from '@/components/ui'
import { markVerifiedBatch } from './[id]/actions'

export interface ProgramRow {
  id: string
  schoolName: string
  programName: string
  region: string
  direction: string
  verifiedLabel: string
  confidence: string
}

/**
 * 待核对队列。
 *
 * 勾选是有意做成「只能勾当前这一页看得见的行」的 —— 没有「全选全库 310 条」。
 * 一键把全库标记成已核对,等于把地区开放的 90% 门槛变成走过场,
 * 那还不如不要这道门槛。
 */
export function ProgramList({ rows }: { rows: ProgramRow[] }) {
  const router = useRouter()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const toggle = (id: string) =>
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const allOnPage = rows.length > 0 && rows.every((r) => sel.has(r.id))

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-3 py-3">
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={allOnPage}
            onChange={() =>
              setSel(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))
            }
          />
          选中本页 {rows.length} 条
        </label>

        <span className="text-sm text-ink-500">已选 {sel.size}</span>

        <Button
          size="sm"
          disabled={pending || sel.size === 0}
          onClick={() =>
            startTransition(async () => {
              const res = await markVerifiedBatch([...sel])
              setMsg(`已把 ${res.count} 条标记为核对通过。`)
              setSel(new Set())
              router.refresh()
            })
          }
        >
          {pending ? '处理中…' : '标记选中项为已核对'}
        </Button>

        <span className="text-xs text-ink-400">
          只在你确实逐条对过官网时才用批量 —— 打勾不核对,等于把错误数据盖章放给用户。
        </span>

        {msg && (
          <span className="rounded bg-green-50 px-2 py-1 text-xs text-green-800">{msg}</span>
        )}
      </Card>

      <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
        {rows.map((p, i) => (
          <div
            key={p.id}
            className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 ${
              i > 0 ? 'border-t border-ink-100' : ''
            } ${sel.has(p.id) ? 'bg-brand-50/50' : ''}`}
          >
            <input
              type="checkbox"
              checked={sel.has(p.id)}
              onChange={() => toggle(p.id)}
              className="shrink-0"
            />
            <div className="min-w-0 flex-1">
              <Link
                href={`/admin/programs/${p.id}`}
                className="font-medium text-ink-900 hover:underline"
              >
                {p.schoolName}
              </Link>
              <p className="truncate text-sm text-ink-600">{p.programName}</p>
            </div>
            <span className="shrink-0 text-xs text-ink-400">
              {p.region} · {p.direction}
            </span>
            <span className="shrink-0 text-xs text-ink-400">{p.verifiedLabel}</span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                p.confidence === 'verified'
                  ? 'bg-green-50 text-green-800'
                  : 'bg-amber-50 text-amber-800'
              }`}
            >
              {p.confidence === 'verified' ? '已核对' : '待核对'}
            </span>
            <Link
              href={`/admin/programs/${p.id}`}
              className="shrink-0 text-xs text-brand-600 hover:underline"
            >
              核对 →
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}
