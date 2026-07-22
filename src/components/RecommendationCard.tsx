'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatCents } from '@/lib/utils'
import type { RecommendationCard as CardData } from '@/lib/recommendation/types'
import { dismissCard, clickCard } from '@/app/app/rec-actions'

/**
 * 情境化推荐卡(PRD 4.7)。
 *
 * 设计约束 —— 「克制是长期信任的一部分」:
 *   · 永远可关闭(右上角 ×),关闭后进入冷却期
 *   · 视觉上不使用警示色、不加动效、不遮挡内容
 *   · 文案不制造焦虑,措辞是「可以」而不是「必须」
 */
export function RecommendationCard({ card }: { card: CardData }) {
  const router = useRouter()
  const [hidden, setHidden] = useState(false)
  const [, startTransition] = useTransition()

  if (hidden) return null

  return (
    <div className="relative rounded-xl border border-ink-200 bg-white p-4">
      <button
        aria-label="不再显示"
        onClick={() => {
          setHidden(true)
          startTransition(() => {
            void dismissCard(card.ruleId)
          })
        }}
        className="absolute top-1 right-1 flex h-10 w-10 items-center justify-center text-lg leading-none text-ink-400 hover:text-ink-600"
      >
        ×
      </button>

      <p className="pr-6 text-sm leading-relaxed text-ink-800">{card.copy}</p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={() =>
            startTransition(async () => {
              await clickCard(card.ruleId)
              router.push(`/app/services?highlight=${card.sku.id}`)
            })
          }
          className="rounded-lg border border-brand-500 px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-50"
        >
          了解 {card.sku.name}
        </button>
        <span className="text-xs text-ink-400">
          {formatCents(card.sku.priceCents)} · {card.sku.slaHours} 小时内交付
        </span>
      </div>
    </div>
  )
}
