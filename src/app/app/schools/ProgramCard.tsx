'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, FreshnessBadge } from '@/components/ui'
import { cn, deadlineUrgency } from '@/lib/utils'
import { TIER_TAG_LABEL } from '@/lib/programs/types'
import { addToShortlist } from './actions'
import type { TierTag } from '@prisma/client'

const TIERS: TierTag[] = ['reach', 'match', 'safe']

export interface ProgramCardData {
  id: string
  schoolName: string
  programName: string
  regionLabel: string
  freshness: 'fresh' | 'stale' | 'unverified'
  freshnessLabel: string
  isOnlineOnly: boolean
  /** 一行摘要:学制 · 学费 · 语言要求 */
  facts: string[]
  deadlineText: string
  daysLeft: number | null
  isRolling: boolean
  chosen: boolean
}

/**
 * 院校库里的一张项目卡。
 *
 * ── 改之前是什么样 ──────────────────────────────────────
 * 卡片上只有学校名、项目名,和一段**截断的英文原文**
 * (「Chinese qualifications: a four-year Bachelor's degree with a final
 * overall score of at least 62-75%, depending on the...」)。
 *
 * 三个问题叠在一起:
 *   1. 用户真正要拿来做判断的东西 —— 学费、截止日、学制、语言分 —— 一个都没有,
 *      每个项目都得点进详情页才知道该不该加,139 个项目根本翻不动;
 *   2. 那段英文占掉两行,信息密度极低,而且截断了根本读不完整;
 *   3. 一屏只放得下三张卡。
 *
 * 现在把「决定加不加」需要的字段直接摆上卡片,英文原文留给详情页。
 */
export function ProgramCard({ p }: { p: ProgramCardData }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const urgency = deadlineUrgency(p.daysLeft)

  const add = (tier: TierTag) =>
    startTransition(async () => {
      await addToShortlist(p.id, tier)
      router.refresh()
    })

  return (
    <Card className={cn('p-4', p.chosen && 'bg-ink-50')}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/app/school/${p.id}`}
              className="font-medium text-ink-900 hover:underline"
            >
              {p.schoolName}
            </Link>
            <span className="text-xs text-ink-400">{p.regionLabel}</span>
            <FreshnessBadge freshness={p.freshness} label={p.freshnessLabel} />
            {p.isOnlineOnly && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">
                纯线上 · 通常不支持学生签证
              </span>
            )}
          </div>

          {/* 项目名不截断 —— 学生就是靠它区分同一所学校的十几个项目 */}
          <p className="mt-0.5 text-sm leading-snug text-ink-700">{p.programName}</p>

          {p.facts.length > 0 && (
            <p className="mt-1.5 text-xs text-ink-500">{p.facts.join(' · ')}</p>
          )}

          <p
            className={cn(
              'mt-1 text-xs',
              urgency === 'critical' && 'font-semibold text-urgent-critical',
              urgency === 'warning' && 'text-urgent-warning',
              (urgency === 'normal' || urgency === 'none' || urgency === 'past') &&
                'text-ink-400',
            )}
          >
            {p.deadlineText}
            {p.isRolling && <span className="ml-1 text-ink-400">· 滚动录取,越早越好</span>}
          </p>
        </div>

        <div className="shrink-0">
          {p.chosen ? (
            <span className="text-xs text-ink-400">已在选校单</span>
          ) : (
            <div className="flex flex-col items-end gap-1">
              {/*
                一步加入,不再是「先点加入 → 再从弹出的三个小按钮里选档位」。
                两步那个设计每次都要瞄准第二排出现的小按钮,很容易点错
                (我自己测的时候连着点错两次)。直接把三个档位摆出来,
                点哪个就是哪个档。
              */}
              <div className="flex gap-1">
                {TIERS.map((t) => (
                  <button
                    key={t}
                    disabled={pending}
                    onClick={() => add(t)}
                    className="min-h-9 rounded-lg border border-ink-200 px-2.5 text-xs text-ink-600 transition-colors hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50 sm:min-h-8"
                  >
                    {TIER_TAG_LABEL[t]}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-ink-400">加入选校单</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
