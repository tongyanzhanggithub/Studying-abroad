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
  qsRankLabel: string | null
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
      <Card className="py-3 shadow-sm shadow-ink-100/60">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
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

            <span className="rounded-full bg-ink-50 px-2.5 py-1 text-xs text-ink-500">
              已选 {sel.size}
            </span>

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
              {pending ? '处理中…' : '标记为已核对'}
            </Button>
          </div>

          <span className="max-w-xl text-xs leading-relaxed text-ink-400">
            批量操作仅用于已经确认过的记录,避免把待核对数据提前展示给学生。
          </span>
        </div>

        {msg && (
          <span className="mt-3 inline-block rounded bg-green-50 px-2 py-1 text-xs text-green-800">{msg}</span>
        )}
      </Card>

      <div className="overflow-hidden rounded-xl border border-ink-100 bg-white shadow-sm shadow-ink-100/70">
        <div className="hidden grid-cols-[minmax(0,1fr)_10rem_7rem_5rem] gap-4 border-b border-ink-100 bg-ink-50/80 px-4 py-2 text-xs font-medium text-ink-400 md:grid">
          <span>项目</span>
          <span>地区 / 方向</span>
          <span>核对状态</span>
          <span className="text-right">操作</span>
        </div>
        {rows.map((p, i) => (
          <div
            key={p.id}
            className={`grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_10rem_7rem_5rem] md:items-center md:gap-4 ${
              i > 0 ? 'border-t border-ink-100' : ''
            } ${sel.has(p.id) ? 'bg-brand-50/50' : ''}`}
          >
            <div className="flex min-w-0 gap-3">
              <input
                type="checkbox"
                checked={sel.has(p.id)}
                onChange={() => toggle(p.id)}
                className="mt-1 shrink-0"
              />
              <div className="min-w-0">
                <Link
                  href={`/admin/programs/${p.id}`}
                  className="font-medium text-ink-900 hover:text-brand-700"
                >
                  {p.schoolName}
                </Link>
                {p.qsRankLabel && (
                  <span className="ml-2 inline-flex rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                    {p.qsRankLabel}
                  </span>
                )}
                <p className="truncate text-sm text-ink-600">{p.programName}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1 text-xs text-ink-500">
              <span>{p.region}</span>
              <span className="text-ink-300">·</span>
              <span>{p.direction}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2 md:block md:space-y-1">
              <span
                className={`rounded px-1.5 py-0.5 text-xs ${
                  p.confidence === 'verified'
                    ? 'bg-green-50 text-green-800'
                    : 'bg-amber-50 text-amber-800'
                }`}
              >
                {p.confidence === 'verified' ? '已核对' : '待核对'}
              </span>
              {p.verifiedLabel !== '未核对' && (
                <span className="text-xs text-ink-400">{p.verifiedLabel}</span>
              )}
            </div>

            <Link
              href={`/admin/programs/${p.id}`}
              className="text-sm font-medium text-brand-600 hover:text-brand-700 md:text-right"
            >
              核对 →
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}
