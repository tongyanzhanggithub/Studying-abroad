'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn, deadlineUrgency } from '@/lib/utils'
import { APPLICATION_STATUS_LABEL, TIER_TAG_LABEL } from '@/lib/programs/types'
import { removeFromShortlist, updateStatus, updateTier } from './actions'
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
  const router = useRouter()
  const [, startTransition] = useTransition()
  const urgency = deadlineUrgency(daysLeft)

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
    <div className="space-y-2">
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
          onChange={(e) =>
            startTransition(async () => {
              await updateTier(choiceId, e.target.value as TierTag)
              router.refresh()
            })
          }
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
          onChange={(e) =>
            startTransition(async () => {
              await updateStatus(choiceId, e.target.value as ApplicationStatus)
              router.refresh()
            })
          }
          className="min-h-9 rounded-lg border border-ink-100 bg-ink-50 px-2 text-xs text-ink-600"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{APPLICATION_STATUS_LABEL[s]}</option>
          ))}
        </select>

        <button
          onClick={() =>
            startTransition(async () => {
              await removeFromShortlist(choiceId)
              router.refresh()
            })
          }
          className="ml-auto inline-flex min-h-9 items-center px-1 text-xs text-ink-400 hover:text-red-600"
        >
          移除
        </button>
      </div>
    </div>
  )
}
