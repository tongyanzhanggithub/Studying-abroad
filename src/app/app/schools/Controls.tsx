'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { cn, deadlineUrgency } from '@/lib/utils'
import { APPLICATION_STATUS_LABEL, TIER_TAG_LABEL } from '@/lib/programs/types'
import type { ApplicationStatus, TierTag } from '@prisma/client'

const TIERS: TierTag[] = ['reach', 'match', 'safe']
const STATUSES: ApplicationStatus[] = [
  'not_started', 'preparing_materials', 'writing_essay', 'ready_to_submit',
  'submitted', 'interview_invited', 'admitted', 'rejected', 'waitlisted',
]

export function ShortlistControls({
  choiceId,
  tierTag,
  status,
  schoolName,
  programName,
  programId,
  deadline,
  daysLeft,
}: {
  choiceId: string
  tierTag: TierTag
  status: ApplicationStatus
  schoolName: string
  programName: string
  programId: string
  deadline: string
  daysLeft: number | null
}) {
  const [busy, setBusy] = useState<'tier' | 'status' | 'remove' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const urgency = deadlineUrgency(daysLeft)

  const run = (
    nextBusy: 'tier' | 'status' | 'remove',
    payload: { action: 'tier'; tierTag: TierTag } | { action: 'status'; status: ApplicationStatus } | { action: 'remove' },
  ) => {
    setError(null)
    setBusy(nextBusy)
    startTransition(async () => {
      try {
        const res = await fetch('/api/shortlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ choiceId, ...payload }),
        })
        const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
        if (!res.ok || !json?.ok) {
          setError(json?.error ?? '操作失败,请刷新后再试')
          setBusy(null)
          return
        }
        window.location.reload()
      } catch {
        setError('网络开小差了,请再试一次')
        setBusy(null)
      }
    })
  }

  const countdown =
    daysLeft === null
      ? deadline
      : daysLeft < 0
        ? '本轮已截止'
        : daysLeft === 0
          ? '今天截止'
          : `还有 ${daysLeft} 天`

  /**
   * ⚠️ 移动端优先的两行布局。
   *
   * 改之前是一行 flex-wrap:项目名 flex-1、后面跟两个 select。
   * 375px 宽度下两个下拉框把宽度吃光,项目名被压成「会计与金融…」——
   * 而学生就是靠项目名区分同一所学校的十几个项目,这是最不该被截断的东西。
   * 优先级完全反了。
   *
   * 现在名字独占一行不截断,操作放第二行。
   */
  return (
    <div className="space-y-2" data-choice-id={choiceId}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/app/school/${programId}`}
            className="font-medium text-ink-900 hover:underline"
          >
            {schoolName}
          </Link>
          <p className="text-sm leading-snug text-ink-700">{programName}</p>
        </div>
        <span
          className={cn(
            'shrink-0 text-xs',
            urgency === 'critical' && 'font-semibold text-urgent-critical',
            urgency === 'warning' && 'text-urgent-warning',
            (urgency === 'normal' || urgency === 'none' || urgency === 'past') && 'text-ink-400',
          )}
          title={deadline}
        >
          {countdown}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={tierTag}
          aria-label="选校档位"
          disabled={busy !== null}
          onChange={(e) => run('tier', { action: 'tier', tierTag: e.target.value as TierTag })}
          className="min-h-9 rounded-lg border border-ink-200 px-2 text-xs text-ink-700"
        >
          {TIERS.map((t) => (
            <option key={t} value={t}>{TIER_TAG_LABEL[t]}</option>
          ))}
        </select>

        {/*
          申请状态平时由系统按材料/文书进度自动同步(syncApplicationStatuses),
          用户手动改主要是「已递交」「收到面试」这类系统看不到的事。
          所以视觉上压过档位一档,不再和它平起平坐。
        */}
        <select
          value={status}
          aria-label="申请状态"
          disabled={busy !== null}
          onChange={(e) => run('status', { action: 'status', status: e.target.value as ApplicationStatus })}
          className="min-h-9 rounded-lg border border-ink-100 bg-ink-50 px-2 text-xs text-ink-600"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{APPLICATION_STATUS_LABEL[s]}</option>
          ))}
        </select>

        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run('remove', { action: 'remove' })}
          className="ml-auto inline-flex min-h-9 items-center px-1 text-xs text-ink-400 hover:text-red-600 disabled:opacity-50"
        >
          {busy === 'remove' ? '移除中…' : '移除'}
        </button>
      </div>

      {busy && busy !== 'remove' && (
        <p className="text-xs text-brand-600">
          {busy === 'tier' ? '正在更新档位…' : '正在更新状态…'}
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
