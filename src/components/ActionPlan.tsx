import Link from 'next/link'
import { Card } from '@/components/ui'
import type { ActionPlan } from '@/lib/planner/engine'

/**
 * 「现在该做什么」面板。
 *
 * 设计上刻意克制(PRD 14 焦虑管理):
 *   · 一次最多三条 —— 给多了就变成又一个待办列表,等于没给
 *   · 每条都写清楚**为什么是它**,不写「重要」「紧急」这种空话
 *   · 风险提示用中性色,不用红色轰炸。真正来不及的事才需要被看见,
 *     把所有东西都标红等于什么都没标
 */
export function ActionPlanPanel({ plan }: { plan: ActionPlan }) {
  if (plan.actions.length === 0 && plan.risks.length === 0) return null

  return (
    <div className="space-y-3">
      {plan.actions.length > 0 && (
        <Card className="border-brand-200 bg-brand-50/50">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium text-ink-900">现在最该做的</h2>
            {plan.nearestDays !== null && (
              <span className="text-xs text-ink-500">
                最近一个截止日还有 {plan.nearestDays} 天
              </span>
            )}
          </div>

          <ol className="mt-3 space-y-3">
            {plan.actions.map((a, i) => (
              <li key={a.kind + i} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand-300 text-xs font-medium text-brand-700">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink-900">{a.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-600">{a.why}</p>
                </div>
                <Link
                  href={a.href}
                  className="shrink-0 self-center whitespace-nowrap text-xs text-brand-600 hover:underline"
                >
                  {a.cta} →
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {plan.risks.map((r, i) => (
        <Card
          key={r.title + i}
          className={r.level === 'warn' ? 'border-amber-200 bg-amber-50/70' : 'border-dashed'}
        >
          <p className="text-sm font-medium text-ink-900">
            {r.level === 'warn' && <span className="mr-1">⚠</span>}
            {r.title}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-600">{r.detail}</p>
        </Card>
      ))}
    </div>
  )
}
