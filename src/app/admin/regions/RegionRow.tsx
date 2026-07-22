'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button, Card, Field } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { RegionHealth } from '@/lib/regions/gate'
import { setRegionPublic, updateRegionBar } from './actions'
import type { Region } from '@prisma/client'

/**
 * 单个地区的开放状态与核对进度。
 *
 * 展示上刻意把「还差多少条」说成具体数字而不是百分比 ——
 * 运营要知道的是「今天还要核对 37 条」,不是「核对率 73%」。
 */
export function RegionRow({
  health,
  adminId,
}: {
  health: RegionHealth
  adminId: string
}) {
  void adminId
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [rate, setRate] = useState(String(Math.round(health.minVerifiedRate * 100)))
  const [count, setCount] = useState(String(health.minPrograms))
  const [note, setNote] = useState(health.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const pct = health.total > 0 ? Math.round(health.verifiedRate * 100) : 0

  return (
    <Card className={cn(health.isPublic && 'border-safe/40')}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium text-ink-900">{health.label}</h2>
            {health.isPublic ? (
              <span className="rounded-full bg-safe/10 px-2 py-0.5 text-xs text-safe">
                已开放
              </span>
            ) : health.meetsBar ? (
              <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">
                已达标,待开放
              </span>
            ) : (
              <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-600">
                未开放
              </span>
            )}
          </div>

          <p className="mt-1.5 text-sm text-ink-600">
            {health.total} 个项目 · 已核对 {health.verified} · 待核对 {health.pending}
          </p>

          {/* 核对进度条 */}
          <div className="mt-2 h-1.5 max-w-md overflow-hidden rounded-full bg-ink-100">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                health.meetsBar ? 'bg-safe' : 'insta-gradient',
              )}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>

          {/* 说人话的差距描述 */}
          <p className="mt-2 text-xs leading-relaxed text-ink-500">
            {health.meetsBar ? (
              <>核对率 {pct}%,已达开放门槛。</>
            ) : (
              <>
                核对率 {pct}%(门槛 {Math.round(health.minVerifiedRate * 100)}%)。
                {health.verifyGap > 0 && (
                  <> 还需再核对 <strong className="text-ink-700">{health.verifyGap}</strong> 条。</>
                )}
                {health.programGap > 0 && (
                  <>
                    {' '}项目数 {health.total},还差{' '}
                    <strong className="text-ink-700">{health.programGap}</strong> 个才够开放 ——
                    需要补采集。
                  </>
                )}
              </>
            )}
          </p>

          {health.note && (
            <p className="mt-2 rounded-lg bg-ink-50 px-2.5 py-1.5 text-xs leading-relaxed text-ink-600">
              {health.note}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {health.isPublic ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await setRegionPublic(health.region as Region, false)
                  if (!res.ok) setError(res.error)
                  else router.refresh()
                })
              }
            >
              撤下
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={pending || !health.meetsBar}
              onClick={() =>
                startTransition(async () => {
                  setError(null)
                  const res = await setRegionPublic(health.region as Region, true)
                  if (!res.ok) setError(res.error)
                  else router.refresh()
                })
              }
            >
              开放
            </Button>
          )}

          <Link
            href={`/admin/programs?filter=pending&region=${health.region}`}
            className="text-xs text-brand-600 hover:underline"
          >
            去核对 →
          </Link>
          <button
            onClick={() => setEditing(!editing)}
            className="text-xs text-ink-400 hover:text-ink-700"
          >
            {editing ? '收起' : '调门槛'}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}

      {editing && (
        <div className="mt-4 grid gap-3 border-t border-ink-100 pt-4 sm:grid-cols-3">
          <Field label="核对率门槛(%)">
            <input
              type="number"
              min={0}
              max={100}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </Field>
          <Field label="项目数门槛">
            <input
              type="number"
              min={0}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </Field>
          <Field label="备注">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="如:日本数据太薄,补到 20 条再开"
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </Field>
          <div className="sm:col-span-3">
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null)
                  const res = await updateRegionBar(health.region as Region, {
                    minVerifiedRate: Number(rate) / 100,
                    minPrograms: Number(count),
                    note,
                  })
                  if (!res.ok) setError(res.error)
                  else {
                    setEditing(false)
                    router.refresh()
                  }
                })
              }
            >
              {pending ? '保存中…' : '保存门槛'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
