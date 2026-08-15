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

/**
 * 排名文案。
 *
 * ⚠️ 学科排名必须写出**是哪个学科**。
 *    早先统一渲染成「QS 2027 专业 #12」—— 用户没法判断这个 12 是
 *    「会计与金融第 12」还是「工程与技术大类第 12」,而这两者含金量差很远。
 *    学科名由调用方通过 subjectName 传入(见 lib/programs/qs-subjects.ts 的映射),
 *    传不进来才退回「专业」两个字。
 */
export function formatRanking(
  provider: RankingProviderCode,
  ranking: RankingLike | null,
  scope: 'overall' | 'subject',
): string | null {
  if (!ranking) return null
  const value = ranking.rankText?.trim() || (ranking.rank ? `#${ranking.rank}` : '')
  if (!value) return null
  const label = RANKING_PROVIDER_LABEL[provider]
  const scopeLabel =
    scope === 'subject' ? (ranking.subjectName?.trim() || '专业') : '综合'
  return ranking.year
    ? `${label} ${ranking.year} ${scopeLabel} ${value}`
    : `${label} ${scopeLabel} ${value}`
}

/**
 * 排序用的名次数值。
 *
 * ⚠️ 区间名次要按**区间下界**参与排序,不能一律丢到最后。
 *    QS 学科榜过了前 100 名就只给区间(「101-150」「201-250」),我们库里
 *    192 条学科名次里有 48 条是区间。全按「无名次」处理的话,一所 101-150 的学校
 *    会排在 601-650 的后面(两者都是 MAX),用户选了「专业排名优先」却看到
 *    乱序 —— 又是那种不报错、结果悄悄是错的情形。
 *
 * 真正没有名次(既没数字也没区间)才排到最后。
 */
export function rankingSortValue(ranking: RankingLike | null): number {
  if (!ranking) return Number.MAX_SAFE_INTEGER
  if (ranking.rank) return ranking.rank
  const range = ranking.rankText?.trim().match(/^(\d+)\s*-\s*\d+$/)
  if (range) return Number(range[1])
  return Number.MAX_SAFE_INTEGER
}
