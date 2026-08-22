import Link from 'next/link'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { RecommendationCard } from '@/components/RecommendationCard'
import { ActionPlanPanel } from '@/components/ActionPlan'
import { selectCard } from '@/lib/recommendation/engine'
import { buildActionPlan } from '@/lib/planner/engine'
import { getMaterialProgress, syncApplicationStatuses } from '@/lib/materials/generate'
import { daysUntil, deadlineUrgency, formatDate, cn } from '@/lib/utils'
import {
  APPLICATION_STATUS_LABEL,
  TIER_TAG_LABEL,
  programFreshness,
  isSubmittedOrLater,
} from '@/lib/programs/types'
import { countdownDeadline, isCountdownable, deadlineText } from '@/lib/programs/deadline'

/**
 * 学生工作台总览(PRD 4.3)。
 *
 * 焦虑管理原则(PRD 14):倒计时清晰但不制造恐慌 ——
 * 只有真正紧迫(≤3 天)才用红色,7 天内用琥珀色,其余保持中性。
 */

const URGENCY_STYLE = {
  past: 'text-ink-400',
  critical: 'text-urgent-critical font-semibold',
  warning: 'text-urgent-warning',
  normal: 'text-ink-600',
  none: 'text-ink-400',
} as const

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <p className="text-xs text-ink-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-400">{sub}</p>}
    </Card>
  )
}

export default async function DashboardPage() {
  const user = await requireUser()

  // 进入总览时同步一次状态机 —— 保证材料勾选后状态即时反映
  await syncApplicationStatuses(user.id)

  const [choices, materialProgress, essays, recCard, plan] = await Promise.all([
    db.userSchoolChoice.findMany({
      where: { userId: user.id },
      include: { program: { include: { school: true } } },
      orderBy: { sort: 'asc' },
    }),
    getMaterialProgress(user.id),
    db.essay.findMany({ where: { userId: user.id } }),
    selectCard(user.id, 'dashboard_school_row'),
    buildActionPlan(user.id),
  ])

  const essaysFinal = essays.filter((e) => e.status === 'final').length
  const submitted = choices.filter((c) => isSubmittedOrLater(c.status)).length

  /**
   * ⚠️ 「最近截止 N 天」是这一页说得最肯定的一句话,所以它只能建立在
   *    **档次已核、确实适用于我们用户**的截止日上 —— 用 countdownDeadline
   *    过一道闸,口径不明的当作没有。见 lib/programs/deadline.ts。
   *
   *    此前这里是裸的 finalDeadline:院校库对同一个项目写「截止日以官网为准」,
   *    仪表盘却把它算进「最近截止 12 天」,两页自相矛盾,而用户更信仪表盘。
   */
  const upcoming = choices
    .map((c) => ({
      choice: c,
      days: daysUntil(countdownDeadline(c.program.finalDeadline, c.program.deadlineAudience)),
    }))
    .filter((x): x is { choice: (typeof choices)[number]; days: number } => x.days !== null && x.days >= 0)
    .sort((a, b) => a.days - b.days)

  const nearest = upcoming[0]
  /** 有没有**能拿来倒计时**的截止日 —— 存了日期但口径不明的不算 */
  const hasUsableDeadline = choices.some((c) =>
    countdownDeadline(c.program.finalDeadline, c.program.deadlineAudience),
  )
  /** 存了日期、但档次没核过的项目数 —— 用于把上面那个「没有」说清楚是哪一种 */
  const unverifiedDeadlines = choices.filter(
    (c) => c.program.finalDeadline && !isCountdownable(c.program.deadlineAudience),
  ).length

  /**
   * 一件事都还没做的时候,不要给他看四个 0。
   *
   * ⚠️ 用户刚付了一两千块进来。这时候的四个 0 传达的是「你买了个空壳」,
   *    而不是「你还没开始」。付费后已经会先跳 onboarding
   *    (见 src/app/pay/mock/.../actions.ts),但跳过引导、中途退出、
   *    或者用老账号重新登录的人都会落到这里,所以这一层兜底不能省。
   */
  const isFresh = choices.length === 0 && materialProgress.total === 0 && essays.length === 0

  const STEPS = [
    { n: 1, title: '挑学校', desc: '院校库里加几所进选校单,顺手标上冲刺 / 匹配 / 保底', href: '/app/schools', cta: '去挑学校' },
    { n: 2, title: '理材料', desc: '清单会按你的选校单自动生成,成绩单这类多校共用的只列一次', href: '/app/materials', cta: '看材料清单' },
    { n: 3, title: '写文书', desc: 'AI 通过提问帮你挖素材、给结构建议、逐句改语法 —— 文字得是你自己的', href: '/app/essays', cta: '开始写' },
    { n: 4, title: '盯截止', desc: '14/7/3/1 天自动提醒,学校改要求也会第一时间告诉你', href: '/app/dashboard', cta: '' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">总览</h1>
        <p className="mt-1 text-sm text-ink-600">
          {choices.length ? `已选 ${choices.length} 所` : '还没有选校,先去院校库挑几所'}
        </p>
      </div>

      {isFresh && (
        <Card className="border-brand-200 bg-brand-50/50">
          <h2 className="font-medium text-ink-900">从这四步开始</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-600">
            按顺序走一遍,大概二十分钟就能把这个申请季的骨架搭起来。之后随时能回来改。
          </p>
          <ol className="mt-4 space-y-3">
            {STEPS.map((s) => (
              <li key={s.n} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand-300 text-xs font-medium text-brand-700">
                  {s.n}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink-900">{s.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-600">{s.desc}</p>
                </div>
                {s.cta && (
                  <Link
                    href={s.href}
                    className="shrink-0 self-center text-xs text-brand-600 hover:underline"
                  >
                    {s.cta} →
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {/* 「该做什么」放在数字前面 —— 数字是结果,行动才是用户来这一页的目的 */}
      {!isFresh && <ActionPlanPanel plan={plan} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          label="材料完成度"
          value={`${materialProgress.percent}%`}
          sub={`${materialProgress.done}/${materialProgress.total} 项`}
        />
        <Metric label="文书进度" value={`${essaysFinal}/${essays.length}`} sub="已终稿" />
        <Metric label="已递交" value={`${submitted}/${choices.length}`} sub="所院校" />
        <Metric
          label="最近截止"
          value={nearest ? `${nearest.days} 天` : '—'}
          sub={nearest ? nearest.choice.program.school.nameZh ?? '' : '暂无截止日期'}
        />
      </div>

      {/*
        截止日期不可用时的诚实提示。

        ⚠️ 「没有截止日」其实是两种完全不同的情况,不能混成一句话:
           · 官网还没公布 —— 等就行了,我们会推送
           · 库里有日期,但没核过是哪一档 —— 学生得自己去官网确认,
             因为英国院校普遍分「需签证 / 本地」两档,取错档会差两个月
           后者说成「还没公布」等于让他安心等一个永远不会来的推送。
      */}
      {choices.length > 0 && !hasUsableDeadline && (
        <Card className="border-dashed">
          <p className="text-sm leading-relaxed text-ink-600">
            {unverifiedDeadlines > 0 ? (
              <>
                你选的院校里有 <strong>{unverifiedDeadlines}</strong> 个项目,官网公布了截止日,
                但我们还没核实那个日期针对的是哪一类申请人 —— 英国院校普遍分「需签证」和「本地」
                两档,时间常常差一两个月。在核完之前我们不做倒计时,
                <strong>请以项目官网为准</strong>。
              </>
            ) : (
              <>
                你选的院校目前都还没有公布申请截止日期 —— 多数学校会在 9-10 月陆续放出。
                我们不会拿上一届的日期充数,一旦官网更新,系统会自动推送给你。
              </>
            )}
          </p>
        </Card>
      )}

      {recCard && <RecommendationCard card={recCard} />}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-ink-900">院校申请进度</h2>
          <Link href="/app/schools" className="text-sm text-brand-600 hover:underline">
            管理选校单 →
          </Link>
        </div>

        {choices.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-600">
              选校单是空的。
              <Link href="/app/schools" className="ml-1 text-brand-600 hover:underline">
                去院校库挑学校 →
              </Link>
            </p>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
            {choices.map((c, i) => {
              const rawDays = daysUntil(c.program.finalDeadline)
              /**
               * 紧急度着色(红/橙)也是一种断言 —— 口径不明的日期不参与,
               * 否则一个可能根本不适用的日期会把这一行标成红色。
               */
              const urgency = deadlineUrgency(
                isCountdownable(c.program.deadlineAudience) ? rawDays : null,
              )
              const freshness = programFreshness(c.program)
              return (
                <div
                  key={c.id}
                  className={cn(
                    'flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3',
                    i > 0 && 'border-t border-ink-100',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-ink-900">
                        {c.program.school.nameZh ?? c.program.school.nameEn}
                      </span>
                      <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600">
                        {TIER_TAG_LABEL[c.tierTag]}
                      </span>
                    </div>
                    <p className="truncate text-sm text-ink-600">
                      {c.program.nameZh ?? c.program.nameEn}
                    </p>
                  </div>

                  <span className="shrink-0 text-sm text-ink-600">
                    {APPLICATION_STATUS_LABEL[c.status]}
                  </span>

                  {/*
                    ⚠️ 文案统一走 lib/programs/deadline.ts 的 deadlineText,
                       不要在这里自己拼 —— 院校库和这里各写一套,正是
                       同一个项目在两页出现两种说法的原因。
                       传**未经闸门**的 rawDays:deadlineText 内部按 audience
                       自己决定说不说得出口(说不出口时降级成「以官网为准」)。
                  */}
                  <span className={cn('shrink-0 text-sm', URGENCY_STYLE[urgency])}>
                    {c.program.finalDeadline
                      ? rawDays !== null && rawDays < 0
                        ? // 已过期的日期不是断言,把具体日期留着 —— 用户要据此决定还申不申
                          `${deadlineText(rawDays, true, c.program.deadlineAudience)} · ${formatDate(c.program.finalDeadline)}`
                        : deadlineText(rawDays, true, c.program.deadlineAudience)
                      : freshness === 'unverified'
                        ? '截止日待公布'
                        : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
