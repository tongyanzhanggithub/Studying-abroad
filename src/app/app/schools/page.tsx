import Link from 'next/link'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { Card, FreshnessBadge } from '@/components/ui'
import { RecommendationCard } from '@/components/RecommendationCard'
import { selectCard } from '@/lib/recommendation/engine'
import { publicProgramWhere } from '@/lib/regions/gate'
import { daysUntil, formatDate } from '@/lib/utils'
import {
  DIRECTION_LABEL,
  REGION_LABEL,
  TIER_TAG_LABEL,
  FRESHNESS_LABEL,
  programFreshness,
  readRequirements,
} from '@/lib/programs/types'
import {
  RANKING_PROVIDER_LABEL,
  formatQsRank,
  formatRanking,
  latestRanking,
  parseRankingProvider,
  parseRankingSort,
  rankingSortValue,
  type RankingLike,
} from '@/lib/programs/ranking'
import { ShortlistControls } from './Controls'
import { ProgramCard } from './ProgramCard'
import type { Direction, Region } from '@prisma/client'

/**
 * 选校管理(PRD 4.2 / 4.4)。
 * 左:我的选校单(冲刺/匹配/保底分档);右:院校库检索。
 */

/** 摘要行:只放「决定加不加」真正用得上的字段 */
function factsOf(p: {
  durationMonths: number | null
  tuition: string | null
  requirements: unknown
}): string[] {
  const out: string[] = []
  if (p.durationMonths) out.push(`${p.durationMonths} 个月`)

  const req = readRequirements(p as never)
  const ielts = req.ielts?.overall
  if (ielts) out.push(`雅思 ${ielts}`)
  else if (req.toefl?.overall) out.push(`托福 ${req.toefl.overall}`)

  const fee = shortTuition(p.tuition)
  if (fee) out.push(fee)
  return out
}

/**
 * 学费原文常常是「Overseas £34,950; Home £20,050 (2026/27, full-time)」这种,
 * 直接按长度截会切成「Home £20,050 (20…」—— 既难看又漏掉了关键那一档。
 *
 * 中国学生交的是国际生学费,Home 那档跟他们无关。所以优先只挑出国际生的金额;
 * 认不出结构再退回原文截断,详情页有完整原文。
 */
function shortTuition(raw: string | null): string | null {
  if (!raw) return null
  const t = raw.trim()

  /**
   * ⚠️ 金额必须带币种符号才算数。
   *
   * 早先的写法是「关键词后面跟一串数字」,结果
   * 「£44,950 (Overseas, 2026/27)」里的 **2026** 被当成了学费,
   * 卡片上显示「国际生 2026」。把年份当价格展示比不展示更糟 ——
   * 用户会真的以为这个项目只要两千。
   */
  const MONEY =
    /(?:[£$€¥]|HK\$|S\$|A\$|C\$|NT\$|RMB|CNY|GBP|USD|EUR|SGD|HKD|AUD|CAD|JPY|KRW|CHF)\s?\d[\d,]{2,}/gi

  const amounts: Array<{ text: string; at: number }> = []
  for (const m of t.matchAll(MONEY)) {
    amounts.push({ text: m[0].replace(/\s+/g, ' ').trim(), at: m.index ?? 0 })
  }
  if (amounts.length === 0) {
    return t.length > 26 ? `${t.slice(0, 26)}…` : t
  }

  // 中国学生交的是国际生学费,Home 那档跟他们无关
  const kw = t.match(/overseas|international|non-?eu|海外|国际生/i)
  if (kw && kw.index !== undefined) {
    // 关键词可能在金额前(Overseas £44,950)也可能在后(£44,950 (Overseas)),
    // 取距离最近的那个金额
    const nearest = amounts.reduce((best, a) =>
      Math.abs(a.at - kw.index!) < Math.abs(best.at - kw.index!) ? a : best,
    )
    return `国际生 ${nearest.text}`
  }

  // 没分档的:金额有多个时取最大的那个(通常就是国际生档)
  const max = amounts.reduce((best, a) =>
    Number(a.text.replace(/\D/g, '')) > Number(best.text.replace(/\D/g, '')) ? a : best,
  )
  return max.text
}

function deadlineText(days: number | null, hasDeadline: boolean): string {
  if (!hasDeadline) return '截止日待公布'
  if (days === null) return '截止日待公布'
  if (days < 0) return '本轮已截止'
  if (days === 0) return '今天截止'
  return `还有 ${days} 天截止`
}

export default async function SchoolsPage({
  searchParams,
}: {
  searchParams: Promise<{
    region?: string
    direction?: string
    q?: string
    sort?: string
    rankingProvider?: string
  }>
}) {
  const user = await requireUser()
  const sp = await searchParams

  const region = sp.region as Region | undefined
  const direction = sp.direction as Direction | undefined
  const q = sp.q?.trim()
  const sort = parseRankingSort(sp.sort)
  const selectedProvider = parseRankingProvider(sp.rankingProvider)
  const rankingProvider =
    selectedProvider ?? (sort === 'overall_rank' || sort === 'subject_rank' ? 'qs' : null)

  const [choices, programs, recCard] = await Promise.all([
    db.userSchoolChoice.findMany({
      where: { userId: user.id },
      include: { program: { include: { school: true } } },
      orderBy: { sort: 'asc' },
    }),
    db.program.findMany({
      where: {
        // 只检索已开放地区 —— 未开放地区的数据核对率不达标,不该进选校单。
        // 闸门在 AND 里,下面用户自选的 region 覆盖不掉它(两者是并且关系)
        ...(await publicProgramWhere()),
        ...(region ? { region } : {}),
        ...(direction ? { direction } : {}),
        ...(q
          ? {
              OR: [
                { nameEn: { contains: q, mode: 'insensitive' } },
                { nameZh: { contains: q } },
                { school: { nameEn: { contains: q, mode: 'insensitive' } } },
                { school: { nameZh: { contains: q } } },
              ],
            }
          : {}),
      },
      include: { school: { include: { rankings: true } }, rankings: true },
      orderBy:
        sort === 'deadline'
          ? // nulls last:截止日待公布的排在最后,而不是因为 null 排到最前面
            [{ finalDeadline: { sort: 'asc', nulls: 'last' } }, { schoolId: 'asc' }]
          : [{ region: 'asc' }, { schoolId: 'asc' }],
      take: rankingProvider ? 500 : 120,
    }),
    selectCard(user.id, 'schools_top'),
  ])

  const chosenIds = new Set(choices.map((c) => c.programId))
  const overallRankingOf = (p: (typeof programs)[number]): RankingLike | null => {
    if (!rankingProvider) return null
    const stored = latestRanking(p.school.rankings, rankingProvider)
    if (stored) return stored
    if (rankingProvider === 'qs' && p.school.qsRank) {
      return {
        provider: 'qs',
        year: p.school.qsRankYear,
        rank: p.school.qsRank,
        rankText: null,
        sourceUrl: p.school.qsRankSourceUrl,
      }
    }
    return null
  }
  const subjectRankingOf = (p: (typeof programs)[number]): RankingLike | null => {
    if (!rankingProvider) return null
    return latestRanking(p.rankings, rankingProvider)
  }
  const rankedPrograms = [...programs].sort((a, b) => {
    if (sort === 'overall_rank') {
      const byRank = rankingSortValue(overallRankingOf(a)) - rankingSortValue(overallRankingOf(b))
      if (byRank !== 0) return byRank
    }
    if (sort === 'subject_rank') {
      const byRank = rankingSortValue(subjectRankingOf(a)) - rankingSortValue(subjectRankingOf(b))
      if (byRank !== 0) return byRank
      const byOverall = rankingSortValue(overallRankingOf(a)) - rankingSortValue(overallRankingOf(b))
      if (byOverall !== 0) return byOverall
    }
    return 0
  }).slice(0, 120)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-ink-900">选校</h1>

      {recCard && <RecommendationCard card={recCard} />}

      {/* 我的选校单 */}
      <section>
        <h2 className="mb-3 font-semibold text-ink-900">
          我的选校单 <span className="text-sm font-normal text-ink-400">{choices.length} 所</span>
        </h2>

        {choices.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-600">
              还没有选校。可以直接从下面的院校库挑,也可以先做一次评估拿一份推荐名单、一键导入。
            </p>
            <Link
              href="/app/assessments"
              className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
            >
              去评估拿推荐名单 →
            </Link>
          </Card>
        ) : (
          <div className="space-y-4">
            {(['reach', 'match', 'safe'] as const).map((tier) => {
              const list = choices.filter((c) => c.tierTag === tier)
              if (!list.length) return null
              return (
                <div key={tier}>
                  <p className="mb-1.5 text-sm font-medium text-ink-600">
                    {TIER_TAG_LABEL[tier]} · {list.length}
                  </p>
                  <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
                    {list.map((c, i) => (
                      <div
                        key={c.id}
                        className={`px-4 py-3 ${i > 0 ? 'border-t border-ink-100' : ''}`}
                      >
                        <ShortlistControls
                          choiceId={c.id}
                          tierTag={c.tierTag}
                          status={c.status}
                          schoolName={c.program.school.nameZh ?? c.program.school.nameEn}
                          programName={c.program.nameZh ?? c.program.nameEn}
                          programId={c.programId}
                          deadline={
                            c.program.finalDeadline
                              ? formatDate(c.program.finalDeadline)
                              : '待公布'
                          }
                          daysLeft={daysUntil(c.program.finalDeadline)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* 院校库 */}
      <section>
        <h2 className="mb-3 font-semibold text-ink-900">院校库</h2>

        <form className="mb-4 flex flex-wrap gap-2" action="/app/schools">
          <input
            name="q"
            defaultValue={q}
            placeholder="搜索院校或专业"
            className="min-w-40 flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <select
            name="region"
            defaultValue={region ?? ''}
            className="rounded-lg border border-ink-200 px-3 py-2 text-sm"
          >
            <option value="">全部地区</option>
            {Object.entries(REGION_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            name="direction"
            defaultValue={direction ?? ''}
            className="rounded-lg border border-ink-200 px-3 py-2 text-sm"
          >
            <option value="">全部方向</option>
            {Object.entries(DIRECTION_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            name="rankingProvider"
            defaultValue={rankingProvider ?? ''}
            className="rounded-lg border border-ink-200 px-3 py-2 text-sm"
          >
            <option value="">不看排名</option>
            {Object.entries(RANKING_PROVIDER_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            name="sort"
            defaultValue={sort}
            className="rounded-lg border border-ink-200 px-3 py-2 text-sm"
          >
            <option value="default">默认排序</option>
            <option value="deadline">最近截止优先</option>
            <option value="overall_rank">综合排名优先</option>
            <option value="subject_rank">专业排名优先</option>
          </select>
          <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700">
            筛选
          </button>
        </form>

        {programs.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-600">
              没有匹配的项目。院校库还在持续录入中,可以换个筛选条件试试。
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {rankedPrograms.map((p) => {
              const freshness = programFreshness(p)
              const days = daysUntil(p.finalDeadline)
              const overallRanking = rankingProvider ? overallRankingOf(p) : null
              const subjectRanking = rankingProvider ? subjectRankingOf(p) : null
              const rankingBadges = rankingProvider
                ? [
                    formatRanking(rankingProvider, overallRanking, 'overall'),
                    formatRanking(rankingProvider, subjectRanking, 'subject'),
                  ].filter((x): x is string => Boolean(x))
                : [
                    formatQsRank(p.school.qsRank, p.school.qsRankYear),
                  ].filter((x): x is string => Boolean(x))
              return (
                <ProgramCard
                  key={p.id}
                  p={{
                    id: p.id,
                    schoolName: p.school.nameZh ?? p.school.nameEn,
                    programName: p.nameZh ?? p.nameEn,
                    regionLabel: REGION_LABEL[p.region] ?? p.region,
                    rankingBadges,
                    freshness,
                    freshnessLabel: FRESHNESS_LABEL[freshness],
                    isOnlineOnly: p.isOnlineOnly,
                    facts: factsOf(p),
                    deadlineText: deadlineText(days, Boolean(p.finalDeadline)),
                    daysLeft: days,
                    isRolling: p.isRolling,
                    chosen: chosenIds.has(p.id),
                  }}
                />
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
