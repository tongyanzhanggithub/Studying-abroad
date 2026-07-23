import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { Card, FreshnessBadge } from '@/components/ui'
import { publicProgramWhere } from '@/lib/regions/gate'
import { daysUntil } from '@/lib/utils'
import {
  DIRECTION_LABEL,
  REGION_LABEL,
  FRESHNESS_LABEL,
  programFreshness,
  readRequirements,
} from '@/lib/programs/types'
import {
  RANKING_PROVIDER_LABEL,
  formatRanking,
  latestRanking,
  type RankingProviderCode,
} from '@/lib/programs/ranking'

/**
 * 学校总览页。
 *
 * ── 为什么单独有这一页 ──────────────────────────────────
 * 选校卡片上「学校名」原本链到 `/app/school/{项目id}` —— 那是**专业详情**。
 * 学生点学校名,想看的是「这所学校怎么样、还开了哪些我能申的专业」,
 * 结果却跳进某一个专业的详情页,和预期完全不符。
 *
 * 现在分成两条:学校名 → 这一页(学校整体 + 排名 + 该校全部项目);
 * 专业名 → `/app/school/{项目id}`(那一个专业的完整要求)。
 *
 * ⚠️ 只列**已开放地区**的项目 —— 和选校页同一道闸门,
 *    否则会从这里绕过地区限制看到未核对地区的数据。
 */

const PROVIDERS: RankingProviderCode[] = ['qs', 'the', 'arwu', 'us_news']

export default async function UniversityPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireUser()
  const { id } = await params

  const school = await db.school.findUnique({
    where: { id },
    include: { rankings: true },
  })
  if (!school) notFound()

  const programs = await db.program.findMany({
    where: { schoolId: school.id, ...(await publicProgramWhere()) },
    include: { rankings: true },
    orderBy: [{ direction: 'asc' }, { nameEn: 'asc' }],
  })

  /**
   * 排名逐榜展示,并注明年份与来源 —— 排名每年变、不同榜单差异很大,
   * 只写一个「#25」而不说是哪个榜、哪一年,等于让学生拿一个不可核对的
   * 数字做决定(PRD 4.2)。
   */
  const rankingRows = PROVIDERS.map((provider) => {
    const stored = latestRanking(school.rankings, provider)
    if (stored) {
      return {
        provider,
        text: formatRanking(provider, stored, 'overall'),
        sourceUrl: stored.sourceUrl ?? null,
      }
    }
    // 兼容早期只存了 School.qsRank 的数据
    if (provider === 'qs' && school.qsRank) {
      return {
        provider,
        text: formatRanking(
          'qs',
          { provider: 'qs', year: school.qsRankYear, rank: school.qsRank },
          'overall',
        ),
        sourceUrl: school.qsRankSourceUrl ?? null,
      }
    }
    return null
  }).filter((r): r is NonNullable<typeof r> => r !== null && Boolean(r.text))

  return (
    <div className="space-y-6">
      <Link href="/app/schools" className="text-sm text-brand-600 hover:underline">
        ← 返回选校
      </Link>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-ink-900">
            {school.nameZh ?? school.nameEn}
          </h1>
          <span className="text-sm text-ink-400">{REGION_LABEL[school.region] ?? school.region}</span>
        </div>
        {school.nameZh && <p className="mt-0.5 text-sm text-ink-500">{school.nameEn}</p>}
      </div>

      {/* ── 排名 ─────────────────────────────────── */}
      <Card>
        <h2 className="mb-3 font-medium text-ink-900">世界排名</h2>
        {rankingRows.length === 0 ? (
          <p className="text-sm leading-relaxed text-ink-500">
            这所学校还没有录入排名数据。我们宁可留空,也不写一个来源不明的数字 ——
            排名每年变化,不同榜单口径差异也很大。
          </p>
        ) : (
          <ul className="space-y-2">
            {rankingRows.map((r) => (
              <li key={r.provider} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="inline-flex min-w-16 justify-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                  {RANKING_PROVIDER_LABEL[r.provider]}
                </span>
                <span className="text-ink-800">{r.text}</span>
                {r.sourceUrl && (
                  <a
                    href={r.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-brand-600 hover:underline"
                  >
                    查看来源 →
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs leading-relaxed text-ink-400">
          排名仅供参考,不代表录取难度。同一所学校不同专业的竞争程度可能差很多。
        </p>
      </Card>

      {/* ── 该校可申请的项目 ───────────────────────── */}
      <section>
        <h2 className="mb-3 font-medium text-ink-900">
          这所学校可申请的项目
          <span className="ml-2 text-sm font-normal text-ink-400">{programs.length} 个</span>
        </h2>

        {programs.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-600">
              这所学校目前没有已开放的项目。可能是所在地区还未开放,或数据仍在核对中。
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {programs.map((p) => {
              const req = readRequirements(p)
              const days = daysUntil(p.finalDeadline)
              const facts: string[] = []
              if (p.durationMonths) facts.push(`${p.durationMonths} 个月`)
              if (req.ielts?.overall) facts.push(`雅思 ${req.ielts.overall}`)
              const subject = latestRanking(p.rankings, 'qs')
              return (
                <Card key={p.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/app/school/${p.id}`}
                          className="font-medium text-ink-900 hover:underline"
                        >
                          {p.nameZh ?? p.nameEn}
                        </Link>
                        <span className="text-xs text-ink-400">
                          {DIRECTION_LABEL[p.direction] ?? p.direction}
                        </span>
                        {subject && (
                          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                            {formatRanking('qs', subject, 'subject')}
                          </span>
                        )}
                        <FreshnessBadge
                          freshness={programFreshness(p)}
                          label={FRESHNESS_LABEL[programFreshness(p)]}
                        />
                      </div>
                      {p.nameZh && <p className="mt-0.5 text-xs text-ink-400">{p.nameEn}</p>}
                      {facts.length > 0 && (
                        <p className="mt-1 text-xs text-ink-500">{facts.join(' · ')}</p>
                      )}
                      <p className="mt-1 text-xs text-ink-400">
                        {days === null
                          ? '截止日待公布'
                          : days < 0
                            ? '本轮已截止'
                            : `还有 ${days} 天截止`}
                      </p>
                    </div>
                    <Link
                      href={`/app/school/${p.id}`}
                      className="shrink-0 text-sm text-brand-600 hover:underline"
                    >
                      查看详情 →
                    </Link>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
