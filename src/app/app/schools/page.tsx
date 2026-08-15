import Link from 'next/link'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { Card, FreshnessBadge } from '@/components/ui'
import { RecommendationCard } from '@/components/RecommendationCard'
import { selectCard } from '@/lib/recommendation/engine'
import { publicProgramWhere, getPublicRegions } from '@/lib/regions/gate'
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
import { qsSubjectOf } from '@/lib/programs/qs-subjects'
import { ShortlistControls } from './Controls'
import { ProgramCard } from './ProgramCard'
import { SchoolFilters } from './SchoolFilters'
import type { DeadlineAudience, Direction, Region } from '@prisma/client'

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

/**
 * 截止日文案。
 *
 * ⚠️ 倒计时只有在**这个日期确实适用于我们的用户**时才能说得这么肯定。
 *
 *    2026-08 的核查发现:英国院校普遍公布两个截止日(需签证 / 本地),
 *    库里一度存的是本地那一档 —— UCL 的需签证通道其实已经关闭两个月,
 *    页面却显示「还有 13 天截止」。学生照着它赶材料,然后被拒收。
 *    见 docs/数据核查-2026-08.md。
 *
 *    所以:只有 audience=overseas(需签证/海外档)或 all(官网不分档)
 *    才给倒计时;home 档对我们的用户根本无效,unspecified 是口径不明的存量数据 ——
 *    这两种一律降级成「以官网为准」,宁可少说,不能把一个不适用的日期说成倒计时。
 */
function deadlineText(
  days: number | null,
  hasDeadline: boolean,
  audience: DeadlineAudience,
): string {
  if (!hasDeadline || days === null) return '截止日待公布'

  if (audience === 'home') {
    // 官网只给了本地/无需签证档,对需要签证的中国学生无效
    return '本档次不适用,以官网为准'
  }
  if (audience === 'unspecified') {
    // 存量数据没标口径 —— 不知道取的是哪一档,不能拿它做倒计时
    return days < 0 ? '本轮已截止(口径待核)' : '截止日以官网为准'
  }

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

  const PAGE_SIZE = 120

  const programWhere = {
    // 只检索已开放地区 —— 未开放地区的数据核对率不达标,不该进选校单。
    // 闸门在 AND 里,下面用户自选的 region 覆盖不掉它(两者是并且关系)
    ...(await publicProgramWhere()),
    ...(region ? { region } : {}),
    ...(direction ? { direction } : {}),
    ...(q
      ? {
          OR: [
            { nameEn: { contains: q, mode: 'insensitive' as const } },
            { nameZh: { contains: q } },
            { school: { nameEn: { contains: q, mode: 'insensitive' as const } } },
            { school: { nameZh: { contains: q } } },
          ],
        }
      : {}),
  }

  /**
   * 排名取值。写成结构化入参,是为了让「只查排名字段的轻量行」和
   * 「带全部关联的完整行」都能用同一套比较逻辑,不必写两份。
   */
  type RankBearing = {
    direction: Direction
    rankings: RankingLike[]
    school: {
      qsRank: number | null
      qsRankYear: number | null
      qsRankSourceUrl: string | null
      rankings: RankingLike[]
      subjectRankings: Array<RankingLike & { subject: string }>
    }
  }
  const overallRankingOf = (p: RankBearing): RankingLike | null => {
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
  /**
   * 学科排名。
   *
   * ⚠️ 取值有先后:**项目自己挂的排名优先,没有才用所在学校的学科排名**。
   *    ProgramRanking 是给个别项目开小灶用的(某个项目上了细分榜单);
   *    绝大多数情况下学生看到的应该是学校的学科名次 —— 学科榜本来就是
   *    按「大学 × 学科」发布的,曼大商学院十几个硕士共用同一个名次。
   *
   * ⚠️ 学科名要一路带到文案里。「QS 2027 会计与金融 #12」和
   *    「QS 2027 工程与技术 #12」含金量差很远(后者是大类),
   *    统一渲染成「专业 #12」等于把这个区别抹掉。
   */
  const subjectRankingOf = (p: RankBearing): RankingLike | null => {
    if (!rankingProvider) return null

    const own = latestRanking(p.rankings, rankingProvider)
    if (own) return own

    const qs = qsSubjectOf(p.direction)
    if (!qs) return null
    const bySubject = p.school.subjectRankings.filter((r) => r.subject === qs.subject)
    const stored = latestRanking(bySubject, rankingProvider)
    if (!stored) return null
    // 大类名次标注出来,不让它冒充细分学科名次
    return { ...stored, subjectName: qs.broad ? `${qs.label}(大类)` : qs.label }
  }
  const byRanking = (a: RankBearing, b: RankBearing): number => {
    if (sort === 'overall_rank') {
      return rankingSortValue(overallRankingOf(a)) - rankingSortValue(overallRankingOf(b))
    }
    // 专业排名优先,同名次再看综合排名
    const bySubject =
      rankingSortValue(subjectRankingOf(a)) - rankingSortValue(subjectRankingOf(b))
    if (bySubject !== 0) return bySubject
    return rankingSortValue(overallRankingOf(a)) - rankingSortValue(overallRankingOf(b))
  }

  const isRankingSort = sort === 'overall_rank' || sort === 'subject_rank'

  const fullInclude = {
    school: { include: { rankings: true, subjectRankings: true } },
    rankings: true,
  } as const

  const [choices, recCard] = await Promise.all([
    db.userSchoolChoice.findMany({
      where: { userId: user.id },
      include: { program: { include: { school: true } } },
      orderBy: { sort: 'asc' },
    }),
    selectCard(user.id, 'schools_top'),
  ])

  // 用于标记选校单里那些「地区已撤下 / 项目已下架」的条目(详情页会 404)
  const publicRegionSet = new Set(await getPublicRegions())

  /**
   * ⚠️ 按排名排序必须**先排序再截断**,不能反过来。
   *
   *    早先的写法是「数据库按地区取前 500 条 → 再在内存里按排名排序」。
   *    只要符合条件的项目超过 500,排名第一的学校就可能落在第 501 位被切掉 ——
   *    用户明明选了「综合排名优先」,却看不到最好的学校,而且页面不会有任何提示。
   *    这类「不报错、只是结果悄悄是错的」问题,对一个把数据准确性当卖点的产品最致命。
   *
   *    改成两段查询:先只取排名字段(轻量,不带其它关联)把**全部**候选排好序,
   *    取前 120 个 id,再查这 120 条的完整数据。任何规模都正确。
   */
  let programs: Awaited<ReturnType<typeof fetchFull>>
  async function fetchFull(ids?: string[]) {
    return db.program.findMany({
      where: ids ? { id: { in: ids } } : programWhere,
      include: fullInclude,
      orderBy: ids
        ? undefined
        : sort === 'deadline'
          ? // nulls last:截止日待公布的排在最后,而不是因为 null 排到最前面
            [{ finalDeadline: { sort: 'asc' as const, nulls: 'last' as const } }, { schoolId: 'asc' as const }]
          : [{ region: 'asc' as const }, { schoolId: 'asc' as const }],
      take: ids ? undefined : PAGE_SIZE,
    })
  }

  if (isRankingSort) {
    // isRankingSort 成立时上面的 ?? 兜底保证了 rankingProvider 必有值,这里只是收窄类型
    const provider = rankingProvider ?? 'qs'
    /** 排序只看名次,把关联收窄到比较真正用得上的三个字段 */
    const rankSelect = {
      where: { provider },
      select: { provider: true, year: true, rank: true },
    } as const
    /** 学科排名要多带一个 subject,才能按项目方向挑出对应那条 */
    const subjectRankSelect = {
      where: { provider },
      select: { provider: true, year: true, rank: true, subject: true },
    } as const

    /**
     * ⚠️ 学校排名**单独查一次**,不要跟着 program 一起 include。
     *
     *    早先写的是 `select: { rankings: true, school: { select: { …, rankings: true } } }`,
     *    看着只是一次查询,实际上同一所学校的排名行会**按项目数重复取回**——
     *    一所学校挂 20 个项目,它那几条排名就被搬 20 遍。而这一步是全量扫描
     *    (为了「先排序再截断」的正确性,见上面的注释),没有 take 兜着,
     *    项目数一涨就是成千上万行冗余。
     *
     *    拆成两段:项目只取 id + schoolId(+ 专业排名),学校按去重后的 id 取一次,
     *    在内存里 join。学校那段的行数从「项目数」降到「学校数」。
     *    两段查的都是同一批候选,排序结果和之前完全一致。
     */
    const lite = await db.program.findMany({
      where: programWhere,
      select: { id: true, schoolId: true, direction: true, rankings: rankSelect },
    })

    const schoolRows = await db.school.findMany({
      where: { id: { in: [...new Set(lite.map((p) => p.schoolId))] } },
      select: {
        id: true,
        qsRank: true,
        qsRankYear: true,
        qsRankSourceUrl: true,
        rankings: rankSelect,
        subjectRankings: subjectRankSelect,
      },
    })
    const bySchool = new Map(schoolRows.map((s) => [s.id, s]))
    /** 理论上不会走到(program.schoolId 是外键),留个安全兜底而不是 ! 断言 */
    const NO_SCHOOL = {
      qsRank: null,
      qsRankYear: null,
      qsRankSourceUrl: null,
      rankings: [],
      subjectRankings: [],
    }

    const topIds = lite
      .map((p) => ({
        id: p.id,
        direction: p.direction,
        rankings: p.rankings,
        school: bySchool.get(p.schoolId) ?? NO_SCHOOL,
      }))
      .sort(byRanking)
      .slice(0, PAGE_SIZE)
      .map((p) => p.id)
    const rows = await fetchFull(topIds)
    // in 查询不保证顺序,按排好的 id 次序还原
    const order = new Map(topIds.map((id, i) => [id, i]))
    programs = rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  } else {
    programs = await fetchFull()
  }

  const chosenIds = new Set(choices.map((c) => c.programId))
  const rankedPrograms = programs

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
                          // 地区被撤下 / 项目下架时,详情页会 404 —— 先在这里标出来
                          unavailable={
                            !c.program.active || !publicRegionSet.has(c.program.region)
                          }
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

        <SchoolFilters
          q={q}
          region={region}
          direction={direction}
          rankingProvider={rankingProvider ?? undefined}
          sort={sort}
          regionOptions={Object.entries(REGION_LABEL).map(([value, label]) => ({ value, label }))}
          directionOptions={Object.entries(DIRECTION_LABEL).map(([value, label]) => ({ value, label }))}
          rankingOptions={Object.entries(RANKING_PROVIDER_LABEL).map(([value, label]) => ({ value, label }))}
        />

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
                    schoolId: p.schoolId,
                    schoolName: p.school.nameZh ?? p.school.nameEn,
                    programName: p.nameZh ?? p.nameEn,
                    regionLabel: REGION_LABEL[p.region] ?? p.region,
                    rankingBadges,
                    freshness,
                    freshnessLabel: FRESHNESS_LABEL[freshness],
                    isOnlineOnly: p.isOnlineOnly,
                    facts: factsOf(p),
                    deadlineText: deadlineText(days, Boolean(p.finalDeadline), p.deadlineAudience),
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
