export const RANKING_PROVIDER_LABEL = {
  qs: 'QS',
  the: 'THE',
  arwu: 'ARWU',
  us_news: 'U.S. News',
} as const

export type RankingProviderCode = keyof typeof RANKING_PROVIDER_LABEL
export type RankingSort = 'default' | 'deadline' | 'overall_rank' | 'subject_rank'

export interface RankingLike {
  provider: string
  year?: number | null
  rank: number | null
  rankText?: string | null
  subjectName?: string | null
  sourceUrl?: string | null
}

export function formatQsRank(
  rank: number | null | undefined,
  year?: number | null,
): string | null {
  if (!rank) return null
  return year ? `QS ${year} #${rank}` : `QS #${rank}`
}

export function parseRankingProvider(raw: string | undefined): RankingProviderCode | null {
  if (!raw) return null
  return raw in RANKING_PROVIDER_LABEL ? (raw as RankingProviderCode) : null
}

export function parseRankingSort(raw: string | undefined): RankingSort {
  if (raw === 'deadline' || raw === 'overall_rank' || raw === 'subject_rank') return raw
  return 'default'
}

export function latestRanking<T extends RankingLike>(
  rankings: readonly T[] | null | undefined,
  provider: RankingProviderCode,
): T | null {
  const list = (rankings ?? [])
    .filter((r) => r.provider === provider)
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
  return list[0] ?? null
}

export function formatRanking(
  provider: RankingProviderCode,
  ranking: RankingLike | null,
  scope: 'overall' | 'subject',
): string | null {
  if (!ranking) return null
  const value = ranking.rankText?.trim() || (ranking.rank ? `#${ranking.rank}` : '')
  if (!value) return null
  const label = RANKING_PROVIDER_LABEL[provider]
  const scopeLabel = scope === 'subject' ? '专业' : '综合'
  return ranking.year
    ? `${label} ${ranking.year} ${scopeLabel} ${value}`
    : `${label} ${scopeLabel} ${value}`
}

export function rankingSortValue(ranking: RankingLike | null): number {
  if (!ranking?.rank) return Number.MAX_SAFE_INTEGER
  return ranking.rank
}
