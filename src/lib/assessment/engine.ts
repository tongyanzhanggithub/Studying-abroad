import 'server-only'
import { db } from '@/lib/db'
import { readDeadlines, readRequirements } from '@/lib/programs/types'
import { getPublicRegions } from '@/lib/regions/gate'
import type { Direction, Region, UndergradTier } from '@prisma/client'

/**
 * 免费选校评估 —— 定位规则引擎(PRD 4.1)
 *
 * ⚠️ 刻意不使用模型。规则表由运营在后台维护(AdmissionRule),
 *    保证结果可解释、可人工纠偏。MVP 阶段这是正确的选择。
 *
 * ⚠️ 合规红线(PRD 10.1):输出一律是「预估」区间,不承诺录取。
 *    任何 UI 展示必须带 DISCLAIMER。
 */

export const DISCLAIMER =
  // 纯文本 —— 这串会直接渲染进 JSX,写 markdown 的 ** 只会把星号原样显示出来
  '以上为基于公开录取数据与你所填背景的预估参考,不代表录取承诺。最终结果以院校官方审核为准。'

export interface AssessmentInput {
  undergradTier: UndergradTier
  undergradMajor: string
  gpa: number
  gpaScale: '100' | '4.0'
  languageType: 'ielts' | 'toefl' | 'none'
  languageScore: number | null
  /** 最低单项(雅思小分)。没填就退化成只比总分 —— 不猜、不假设。 */
  languageMinBand?: number | null
  targetRegions: Region[]
  targetDirection: Direction
}

export interface ProgramMatch {
  programId: string
  schoolName: string
  schoolNameEn: string
  programName: string
  programNameEn: string
  region: Region
  tier: 'reach' | 'match' | 'safe'
  /** 预估概率区间,百分比 */
  probabilityLow: number
  probabilityHigh: number
  /** 该项目要求摘要,用于结果页卡片 */
  gpaRequirement: string | null
  /** 数据是否已人工核对 —— 未核对的必须在 UI 上标注 */
  verified: boolean

  // ── 以下字段全部取自采集到的官网数据,拿不到就是 null ──
  durationMonths: number | null
  tuition: string | null
  /** 官网写明的雅思总分要求 */
  ieltsRequired: number | null
  /**
   * 官网写明的最低单项要求(解析自 requirements.ielts.subscores)。
   * 解析不出来就是 null —— 用于在结果页说明「总分够但单项不够」到底卡在哪。
   */
  minBandRequired: number | null
  /** 用户语言成绩与该项目要求的比对结果(已计入单项) */
  languageStatus: LanguageStatus
  /** GMAT/GRE 要求档位 */
  testRequirement: TestRequirement
  /** 最终截止日期(已过期的周期在导入时已置空) */
  finalDeadline: string | null
  isRolling: boolean
}

/** 语言成绩比对结果 */
export type LanguageStatus =
  | 'meets' // 达标
  | 'close' // 差一点(雅思 ≤0.5 / 托福 ≤5)
  | 'below' // 明显不够
  | 'no_score' // 用户还没考
  | 'unknown' // 官网未列明要求,无法比对

/** GMAT/GRE 要求档位 —— 由官网原文关键词判断,判断不了就是 unspecified */
export type TestRequirement = 'required' | 'recommended' | 'not_required' | 'unspecified'

/**
 * 从匹配结果里算出来的整体洞察。
 *
 * ⚠️ 每一条都必须是**对真实采集字段的统计**,不是生成的建议。
 *    拿不到数据的维度宁可不展示,也不编。
 */
export interface AssessmentInsights {
  /** 匹配项目的地区分布 */
  regionBreakdown: Array<{ region: Region; count: number }>

  language: {
    type: 'ielts' | 'toefl' | 'none'
    userScore: number | null
    /** 官网写明了雅思要求的项目数 —— 分母是它,不是总数 */
    withRequirement: number
    meets: number
    close: number
    below: number
    minRequired: number | null
    maxRequired: number | null
  }

  /** GMAT/GRE 要求分布 */
  testing: Record<TestRequirement, number>

  timeline: {
    /** 已公布 2027 入学截止日期的项目数 */
    withDeadline: number
    /** 截止日期尚未公布的项目数 */
    pending: number
    /** 滚动录取的项目数 —— 对申请节奏影响很大 */
    rolling: number
    nearest: { schoolName: string; programName: string; date: string } | null
  }

  /** 数据可信度 —— 直接摊开给用户看,不藏 */
  dataQuality: { verified: number; unverified: number }
}

export interface AssessmentResult {
  reach: ProgramMatch[]
  match: ProgramMatch[]
  safe: ProgramMatch[]
  /**
   * 冲刺档的候补池(PRD 9 分享裂变解锁用)。
   *
   * 这些是**已经算出来但默认不展示**的项目 —— 分享解锁时从这里取,
   * 保证解锁出来的推荐和付费看到的是同一批数据,不存在两套标准。
   */
  reachPool: ProgramMatch[]
  /** 命中的院校总数(付费解锁完整列表) */
  totalMatched: number
  insights: AssessmentInsights
  disclaimer: string
}

/** 4 分制换算百分制(粗略线性映射,仅用于分档,不做精确换算) */
export function normalizeGpa(gpa: number, scale: '100' | '4.0'): number {
  if (scale === '100') return gpa
  // 4.0 → 百分制:3.0≈80, 3.5≈87, 4.0≈95
  return Math.round(60 + (gpa / 4.0) * 35)
}

/**
 * 院校竞争档位。MVP 用 Program.competitiveness 字段(运营标注),
 * 未标注时按地区+是否 G5/港三/新二给一个保守默认。
 */
function inferSchoolTier(schoolNameEn: string, competitiveness: string | null): string {
  // 运营在后台标注过就以标注为准 —— 这是唯一权威来源
  if (competitiveness) return competitiveness

  /**
   * 兜底判断:各地区公认最难申的那一档。
   *
   * ⚠️ 这只是**没人标注时的临时兜底**,不是权威排名。
   *    哪所学校算哪一档是编辑判断,应当由运营在后台
   *    `Program.competitiveness` 字段上逐校标注覆盖。
   */
  const t1 = [
    // 英国
    'Oxford', 'Cambridge', 'London School of Economics', 'Imperial College',
    'University College London',
    // 新加坡
    'National University of Singapore', 'Nanyang Technological',
    // 中国香港
    'Hong Kong University of Science', 'The University of Hong Kong',
    'Chinese University of Hong Kong',
    // 澳大利亚
    'University of Melbourne', 'Australian National University', 'University of Sydney',
    'University of New South Wales',
    // 加拿大
    'University of Toronto', 'McGill', 'University of British Columbia',
    // 日本
    'University of Tokyo', 'Kyoto University',
    // 韩国
    'Seoul National University',
    // 欧洲
    'Trinity College Dublin', 'Delft University of Technology',
    'University of Amsterdam', 'Technical University of Munich',
    'ETH', 'HEC Paris', 'INSEAD',
  ]
  return t1.some((n) => schoolNameEn.includes(n)) ? 't1' : 't2'
}

/**
 * 判断 GMAT/GRE 要求档位。
 *
 * 官网表述是自由文本(如 "Not required. A good GMAT score is favourably considered"),
 * 这里按关键词归档。**判断不了就归为 unspecified,不猜**。
 * 注意顺序:先判否定,否则 "not required" 会被 "required" 命中。
 */
export function classifyTestRequirement(text: string | null | undefined): TestRequirement {
  if (!text) return 'unspecified'
  const t = text.toLowerCase()

  if (/not\s+required|no\s+gmat|not\s+mandatory|optional|不要求|非强制|无需/.test(t)) {
    // 「不强制但强烈建议」按建议算 —— 对申请者而言这更接近实际情况
    if (/recommend|strongly|encouraged|favourab|建议|加分/.test(t)) return 'recommended'
    return 'not_required'
  }
  if (/required|mandatory|必须|必需/.test(t)) return 'required'
  if (/recommend|strongly|encouraged|favourab|建议|加分/.test(t)) return 'recommended'
  return 'unspecified'
}

/**
 * 从「单项要求」原文里解析出最低单项分。
 *
 * 院校库里 61% 的项目写了这一项,常见写法(中英混杂):
 *   「单项不低于6.0」「各项不低于 6.5」「no subtest below 5.5」
 *   「No band below 6.5 (…)」「minimum 6.0 in each component」
 * 明确写「未列明」的返回 null —— 解析不出来时**不猜**,宁可不判。
 */
export function parseMinBandRequirement(subscores: string | null | undefined): number | null {
  if (!subscores) return null
  const t = subscores.toLowerCase()
  if (/未列明|not specified|no specific|未说明/.test(t)) return null

  const patterns = [
    /(?:no\s+(?:band|subtest|component|section)\s+(?:below|lower than)\s*)(\d(?:\.\d)?)/,
    /(?:minimum|min\.?|at least)\s*(?:of\s*)?(\d(?:\.\d)?)\s*(?:in\s+each|per\s+(?:band|component))/,
    /(?:单项|各项|各单项|每项)[^0-9]{0,6}(\d(?:\.\d)?)/,
    /(?:each\s+(?:band|component|subtest)[^0-9]{0,10})(\d(?:\.\d)?)/,
  ]
  for (const re of patterns) {
    const m = t.match(re)
    if (m) {
      const n = Number(m[1])
      // 雅思单项区间 4–9;超出范围说明匹配到了别的数字(如年份),丢弃
      if (Number.isFinite(n) && n >= 4 && n <= 9) return n
    }
  }
  return null
}

/** 用户语言成绩 vs 项目要求 */
function compareLanguage(
  input: AssessmentInput,
  ielts: number | null,
  toefl: number | null,
  ieltsSubscores?: string | null,
): { status: LanguageStatus; required: number | null; minBandRequired: number | null } {
  if (input.languageType === 'none' || input.languageScore == null) {
    return { status: 'no_score', required: ielts, minBandRequired: null }
  }

  const required = input.languageType === 'ielts' ? ielts : toefl
  if (required == null) return { status: 'unknown', required: ielts, minBandRequired: null }

  const score = input.languageScore
  const closeGap = input.languageType === 'ielts' ? 0.5 : 5

  /**
   * ⚠️ 单项先判,而且只对雅思生效(托福单项要求的写法差异太大,不硬套)。
   *    总分够、单项不够 = **不达标**。早先只比总分,会把这种情况报成「达标」,
   *    而它在真实申请里是必被拒的 —— 这是最需要修的一类错误。
   */
  const minBandRequired =
    input.languageType === 'ielts' ? parseMinBandRequirement(ieltsSubscores) : null
  const mine = input.languageMinBand ?? null
  if (minBandRequired != null && mine != null && mine < minBandRequired) {
    const gap = minBandRequired - mine
    return {
      status: gap <= closeGap ? 'close' : 'below',
      required,
      minBandRequired,
    }
  }

  if (score >= required) return { status: 'meets', required, minBandRequired }

  // 「差一点」的阈值:雅思 0.5 分、托福 5 分 —— 大致是一次重考能补上的距离
  return {
    status: required - score <= closeGap ? 'close' : 'below',
    required,
    minBandRequired,
  }
}

/**
 * 核心定位算法:
 *   预估概率 = 查 AdmissionRule 表(地区 × 方向 × 院校档 × 本科层级 × GPA 区间)
 * 查不到规则时不猜 —— 该项目不进结果,避免给出无依据的数字。
 */
export async function runAssessment(
  input: AssessmentInput,
  opts?: { full?: boolean },
): Promise<AssessmentResult> {
  const gpa100 = normalizeGpa(input.gpa, input.gpaScale)

  /**
   * ⚠️ 与已开放地区取交集。
   *
   * 用户可能通过旧链接、缓存表单或手改参数提交一个尚未开放的地区 ——
   * 这里必须再挡一次,不能只靠表单不展示。未开放地区的数据核对率不达标,
   * 放出去就等于拿没核对过的数字给人做决定。
   */
  const publicRegions = await getPublicRegions()
  const allowedRegions = input.targetRegions.filter((r) => publicRegions.includes(r))

  const programs = allowedRegions.length
    ? await db.program.findMany({
        where: {
          active: true,
          region: { in: allowedRegions },
          direction: input.targetDirection,
        },
        include: { school: true },
      })
    : []

  const rules = await db.admissionRule.findMany({
    where: {
      region: { in: input.targetRegions },
      direction: input.targetDirection,
      undergradTier: input.undergradTier,
      // 上界开区间 —— 否则 85 分会同时命中 [80,85] 和 [85,90] 两档,
      // 命中哪条取决于返回顺序,结果不稳定
      gpaMin: { lte: gpa100 },
      gpaMax: { gt: gpa100 },
    },
  })

  const matches: ProgramMatch[] = []

  for (const p of programs) {
    const schoolTier = inferSchoolTier(p.school.nameEn, p.competitiveness)
    const rule = rules.find((r) => r.region === p.region && r.schoolTier === schoolTier)
    // 没有对应规则就跳过 —— 宁可少推荐,也不给无依据的概率
    if (!rule) continue

    const mid = (rule.probabilityLow + rule.probabilityHigh) / 2
    const tier: ProgramMatch['tier'] = mid < 35 ? 'reach' : mid < 70 ? 'match' : 'safe'

    const req = readRequirements(p)
    const dl = readDeadlines(p)

    const ieltsRequired = req.ielts?.overall ?? null
    const toeflRequired = req.toefl?.overall ?? null
    const { status: languageStatus, minBandRequired } = compareLanguage(
      input,
      ieltsRequired,
      toeflRequired,
      req.ielts?.subscores,
    )

    matches.push({
      programId: p.id,
      schoolName: p.school.nameZh ?? p.school.nameEn,
      schoolNameEn: p.school.nameEn,
      programName: p.nameZh ?? p.nameEn,
      programNameEn: p.nameEn,
      region: p.region,
      tier,
      probabilityLow: rule.probabilityLow,
      probabilityHigh: rule.probabilityHigh,
      gpaRequirement: req.gpa_requirement ?? null,
      verified: p.confidence === 'verified' && p.lastVerifiedAt !== null,

      durationMonths: p.durationMonths,
      tuition: p.tuition,
      ieltsRequired,
      minBandRequired,
      languageStatus,
      testRequirement: classifyTestRequirement(req.gmat_gre),
      finalDeadline: dl.final_deadline ?? null,
      isRolling: p.isRolling,
    })
  }

  const byRank = (a: ProgramMatch, b: ProgramMatch) => {
    if (a.verified !== b.verified) return a.verified ? -1 : 1
    return b.probabilityHigh - a.probabilityHigh
  }

  // 每档取概率最高的若干个,已核对数据优先展示
  const pick = (tier: ProgramMatch['tier'], n: number) =>
    matches.filter((m) => m.tier === tier).sort(byRank).slice(0, n)

  /**
   * `full` 给已购季票的用户用:每档返回全部命中项目,不做 3 条截断。
   *
   * ⚠️ 会员看到的是**同一批数据的完整版**,不是另算一遍的另一套结果。
   *    免费版展示的 3 条就是这里排序后的前 3 条 —— 不存在「免费给你看差的、
   *    付费才给你看好的」这种事。数据只有一份,区别只在展示多少。
   */
  const perTier = opts?.full ? Number.MAX_SAFE_INTEGER : 3

  const reach = pick('reach', perTier)
  // 冲刺档第 4-8 名作为分享解锁的候补池(full 模式下已全部展示,池子为空)
  const reachPool = opts?.full
    ? []
    : matches
        .filter((m) => m.tier === 'reach' && !reach.some((r) => r.programId === m.programId))
        .sort(byRank)
        .slice(0, 5)

  return {
    reach,
    match: pick('match', perTier),
    safe: pick('safe', perTier),
    reachPool,
    totalMatched: matches.length,
    insights: buildInsights(input, matches),
    disclaimer: DISCLAIMER,
  }
}

/**
 * 从全部命中项目里统计洞察。
 * 注意分母:语言比对的分母是「官网写明了要求的项目数」,不是命中总数 ——
 * 用总数当分母会把「官网没写」算成「不达标」,那是在误导用户。
 */
function buildInsights(
  input: AssessmentInput,
  matches: ProgramMatch[],
): AssessmentInsights {
  const regionCount = new Map<Region, number>()
  for (const m of matches) regionCount.set(m.region, (regionCount.get(m.region) ?? 0) + 1)

  const testing: Record<TestRequirement, number> = {
    required: 0, recommended: 0, not_required: 0, unspecified: 0,
  }
  for (const m of matches) testing[m.testRequirement] += 1

  const withReq = matches.filter((m) => m.ieltsRequired != null)
  const reqValues = withReq.map((m) => m.ieltsRequired as number)

  // 只统计未来的截止日期。导入脚本已做过一遍清洗,这里是第二道防线 ——
  // 给用户看「还有 -20 天」比不给日期糟糕得多。
  const todayIso = new Date().toISOString().slice(0, 10)
  const dated = matches
    .filter((m): m is ProgramMatch & { finalDeadline: string } => !!m.finalDeadline)
    .filter((m) => m.finalDeadline >= todayIso)
    .sort((a, b) => a.finalDeadline.localeCompare(b.finalDeadline))

  return {
    regionBreakdown: [...regionCount.entries()]
      .map(([region, count]) => ({ region, count }))
      .sort((a, b) => b.count - a.count),

    language: {
      type: input.languageType,
      userScore: input.languageScore,
      withRequirement: withReq.length,
      meets: matches.filter((m) => m.languageStatus === 'meets').length,
      close: matches.filter((m) => m.languageStatus === 'close').length,
      below: matches.filter((m) => m.languageStatus === 'below').length,
      minRequired: reqValues.length ? Math.min(...reqValues) : null,
      maxRequired: reqValues.length ? Math.max(...reqValues) : null,
    },

    testing,

    timeline: {
      /** 已公布**且尚未截止**的项目数 */
      withDeadline: dated.length,
      pending: matches.length - dated.length,
      rolling: matches.filter((m) => m.isRolling).length,
      nearest: dated[0]
        ? {
            schoolName: dated[0].schoolName,
            programName: dated[0].programName,
            date: dated[0].finalDeadline,
          }
        : null,
    },

    dataQuality: {
      verified: matches.filter((m) => m.verified).length,
      unverified: matches.filter((m) => !m.verified).length,
    },
  }
}

/**
 * 是否触发「疑难 case」标记 —— 推荐引擎据此推送会诊服务(PRD 4.7)
 */
export function isDifficultCase(input: AssessmentInput): boolean {
  const gpa100 = normalizeGpa(input.gpa, input.gpaScale)
  return gpa100 < 80
}
