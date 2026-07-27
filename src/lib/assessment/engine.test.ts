import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  buildInsights,
  classifyTestRequirement,
  compareLanguage,
  findTierRule,
  inferSchoolTier,
  isDifficultCase,
  normalizeGpa,
  parseMinBandRequirement,
  type AssessmentInput,
  type ProgramMatch,
} from './engine'

const INPUT = (over: Partial<AssessmentInput> = {}): AssessmentInput => ({
  undergradTier: 'c985_211',
  undergradMajor: '金融学',
  gpa: 85,
  gpaScale: '100',
  languageType: 'ielts',
  languageScore: 7,
  targetRegions: ['UK'],
  targetDirection: 'finance',
  ...over,
})

afterEach(() => vi.restoreAllMocks())

// ════════════════════════════════════════════════════════
// GPA 换算
// ════════════════════════════════════════════════════════

describe('normalizeGpa', () => {
  it('百分制原样返回', () => {
    expect(normalizeGpa(85, '100')).toBe(85)
    expect(normalizeGpa(72.5, '100')).toBe(72.5)
  })

  /**
   * ⚠️ 这几个数字是在**钉住当前实现**,不是在确认它是对的。
   *
   *    函数上方的注释写的是「3.0≈80, 3.5≈87, 4.0≈95」,但公式
   *    `60 + (gpa / 4.0) * 35` 实际算出来是 3.0→86、3.5→91、4.0→95 ——
   *    只有 4.0 对得上,3.0 和 3.5 分别高了 6 分和 4 分。
   *
   *    影响不只是显示:gpa100 会拿去查 AdmissionRule 的 [gpaMin, gpaMax) 区间,
   *    偏高就会命中更高 GPA 段的规则 → **给 4.0 制学生高估录取概率**。
   *    对一个明令「不承诺录取」的产品,往高了估是最糟的方向。
   *
   *    改与不改是产品决策(会改变所有 4.0 制用户的评估结果),先钉住行为。
   */
  it('4.0 制当前实现:3.0 → 86(注释声称 80)', () => {
    expect(normalizeGpa(3.0, '4.0')).toBe(86)
  })

  it('4.0 制当前实现:3.5 → 91(注释声称 87)', () => {
    expect(normalizeGpa(3.5, '4.0')).toBe(91)
  })

  it('4.0 制满绩 → 95(与注释一致)', () => {
    expect(normalizeGpa(4.0, '4.0')).toBe(95)
  })
})

describe('isDifficultCase', () => {
  it('百分制低于 80 算疑难 case', () => {
    expect(isDifficultCase(INPUT({ gpa: 79, gpaScale: '100' }))).toBe(true)
    expect(isDifficultCase(INPUT({ gpa: 80, gpaScale: '100' }))).toBe(false)
  })

  /** 换算偏高的直接后果:4.0 制下要低到 2.28 才会被识别成疑难 case */
  it('4.0 制下 2.5 分不算疑难 case(换算成 82)', () => {
    expect(normalizeGpa(2.5, '4.0')).toBe(82)
    expect(isDifficultCase(INPUT({ gpa: 2.5, gpaScale: '4.0' }))).toBe(false)
  })
})

// ════════════════════════════════════════════════════════
// GMAT/GRE 档位
// ════════════════════════════════════════════════════════

describe('classifyTestRequirement', () => {
  it('空值一律 unspecified,不猜', () => {
    expect(classifyTestRequirement(null)).toBe('unspecified')
    expect(classifyTestRequirement(undefined)).toBe('unspecified')
    expect(classifyTestRequirement('')).toBe('unspecified')
  })

  /**
   * ⚠️ 判断顺序:必须先判否定。
   *    先判 /required/ 的话,"Not required" 会被当成「必须提交」——
   *    学生会为一个根本不要求的考试白准备两个月。
   */
  it('Not required 不能被 required 命中', () => {
    expect(classifyTestRequirement('Not required')).toBe('not_required')
    expect(classifyTestRequirement('GMAT is not mandatory')).toBe('not_required')
  })

  it('「不强制但强烈建议」按建议算 —— 更接近申请者的真实处境', () => {
    expect(
      classifyTestRequirement('Not required. A good GMAT score is favourably considered'),
    ).toBe('recommended')
    expect(classifyTestRequirement('Optional but strongly encouraged')).toBe('recommended')
  })

  it('明确要求', () => {
    expect(classifyTestRequirement('GMAT/GRE is required for all applicants')).toBe('required')
    expect(classifyTestRequirement('GMAT is mandatory')).toBe('required')
  })

  it('中文表述', () => {
    expect(classifyTestRequirement('不要求 GMAT')).toBe('not_required')
    expect(classifyTestRequirement('必须提交 GMAT')).toBe('required')
    expect(classifyTestRequirement('建议提交 GMAT,可加分')).toBe('recommended')
  })

  it('认不出的原文归 unspecified,不硬套', () => {
    expect(classifyTestRequirement('Please refer to the department website')).toBe('unspecified')
  })
})

// ════════════════════════════════════════════════════════
// 雅思单项要求解析
// ════════════════════════════════════════════════════════

describe('parseMinBandRequirement', () => {
  it.each([
    ['no band below 6.5', 6.5],
    ['No subtest below 5.5', 5.5],
    ['minimum 6.0 in each component', 6.0],
    ['at least 6.5 in each', 6.5],
    ['单项不低于6.0', 6.0],
    ['各项不低于 6.5', 6.5],
    ['每项不低于 5.5', 5.5],
  ])('解析「%s」→ %s', (raw, expected) => {
    expect(parseMinBandRequirement(raw)).toBe(expected)
  })

  it('明确写「未列明」的返回 null', () => {
    expect(parseMinBandRequirement('未列明')).toBeNull()
    expect(parseMinBandRequirement('Not specified')).toBeNull()
  })

  it('空值返回 null', () => {
    expect(parseMinBandRequirement(null)).toBeNull()
    expect(parseMinBandRequirement(undefined)).toBeNull()
  })

  /**
   * ⚠️ 4–9 的区间守卫是必需的:原文里混着年份、学分等数字,
   *    匹配到就会得出「单项要求 2026 分」这种荒谬值,而它会让所有人都判成不达标。
   */
  it('超出雅思单项区间(4–9)的数字一律丢弃', () => {
    expect(parseMinBandRequirement('各项不低于 2026 学年标准')).toBeNull()
    expect(parseMinBandRequirement('no band below 3.5')).toBeNull()
  })

  it('认不出结构时返回 null,不猜', () => {
    expect(parseMinBandRequirement('See the language requirements page')).toBeNull()
  })
})

// ════════════════════════════════════════════════════════
// 语言成绩比对
// ════════════════════════════════════════════════════════

describe('compareLanguage —— 没有可比的情况', () => {
  it('用户没考语言 → no_score', () => {
    const r = compareLanguage(INPUT({ languageType: 'none', languageScore: null }), 6.5, 90)
    expect(r.status).toBe('no_score')
  })

  it('填了类型但没填分数 → no_score', () => {
    const r = compareLanguage(INPUT({ languageScore: null }), 6.5, 90)
    expect(r.status).toBe('no_score')
  })

  it('官网没列明要求 → unknown,不能当成达标', () => {
    expect(compareLanguage(INPUT({ languageScore: 7 }), null, 90).status).toBe('unknown')
  })
})

describe('compareLanguage —— 总分比对', () => {
  it('总分达标 → meets', () => {
    expect(compareLanguage(INPUT({ languageScore: 7 }), 6.5, null).status).toBe('meets')
  })

  it('恰好等于要求 → meets', () => {
    expect(compareLanguage(INPUT({ languageScore: 6.5 }), 6.5, null).status).toBe('meets')
  })

  it('雅思差 0.5 以内 → close(一次重考能补上)', () => {
    expect(compareLanguage(INPUT({ languageScore: 6 }), 6.5, null).status).toBe('close')
  })

  it('雅思差超过 0.5 → below', () => {
    expect(compareLanguage(INPUT({ languageScore: 5.5 }), 6.5, null).status).toBe('below')
  })

  it('托福的 close 阈值是 5 分', () => {
    const toefl = (score: number) =>
      compareLanguage(INPUT({ languageType: 'toefl', languageScore: score }), null, 100).status
    expect(toefl(96)).toBe('close')
    expect(toefl(94)).toBe('below')
  })
})

describe('compareLanguage —— 单项(最需要守住的一条)', () => {
  /**
   * ⚠️ 总分够、单项不够,在真实申请里是**必被拒**的。
   *    早先只比总分会把这种情况报成「达标」,学生据此不再重考 —— 这是最坏的一类错误。
   */
  it('总分达标但单项不够 → 不是 meets', () => {
    const r = compareLanguage(
      INPUT({ languageScore: 7, languageMinBand: 5.5 }),
      6.5,
      null,
      'no band below 6.0',
    )
    expect(r.status).not.toBe('meets')
    expect(r.status).toBe('close') // 差 0.5,一次重考能补
    expect(r.minBandRequired).toBe(6.0)
  })

  it('单项差得多 → below', () => {
    const r = compareLanguage(
      INPUT({ languageScore: 7.5, languageMinBand: 5.0 }),
      6.5,
      null,
      '各项不低于 6.5',
    )
    expect(r.status).toBe('below')
  })

  it('单项也达标 → meets', () => {
    const r = compareLanguage(
      INPUT({ languageScore: 7, languageMinBand: 6.5 }),
      6.5,
      null,
      'no band below 6.0',
    )
    expect(r.status).toBe('meets')
  })

  /** 用户没填单项就只比总分 —— 不猜、不假设(会退化,但不会误报) */
  it('用户没填单项 → 退化成只比总分', () => {
    const r = compareLanguage(INPUT({ languageScore: 7 }), 6.5, null, 'no band below 6.0')
    expect(r.status).toBe('meets')
  })

  it('官网没写单项要求 → 只比总分', () => {
    const r = compareLanguage(INPUT({ languageScore: 7, languageMinBand: 5.0 }), 6.5, null, '未列明')
    expect(r.status).toBe('meets')
    expect(r.minBandRequired).toBeNull()
  })

  /** 托福单项写法差异太大,刻意不套雅思那套规则 */
  it('托福不参与单项判断', () => {
    const r = compareLanguage(
      INPUT({ languageType: 'toefl', languageScore: 105, languageMinBand: 15 }),
      null,
      100,
      'no band below 6.0',
    )
    expect(r.status).toBe('meets')
    expect(r.minBandRequired).toBeNull()
  })
})

// ════════════════════════════════════════════════════════
// 院校档位
// ════════════════════════════════════════════════════════

describe('inferSchoolTier —— 运营标注', () => {
  it('合法档位码以标注为准', () => {
    expect(inferSchoolTier('University of Leeds', 't1')).toBe('t1')
    expect(inferSchoolTier('University of Oxford', 't3')).toBe('t3')
  })

  it('大小写与空格不影响', () => {
    expect(inferSchoolTier('University of Leeds', ' T2 ')).toBe('t2')
  })

  /**
   * ⚠️ 后台「名额紧张度」输入框的 placeholder 是「如:第一轮基本招满」,
   *    也就是 UI 在引导运营填自由文本。原来这里把它原样当档位码返回,
   *    导致 findTierRule 查不到规则 → 该项目**从所有学生的评估结果里静默消失**。
   *    而人工核对院校数据正是上线前第一优先的运营动作,几乎必然踩到。
   */
  it('自由文本标注必须被忽略,退回兜底判断并告警', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(inferSchoolTier('University of Oxford', '第一轮基本招满')).toBe('t1')
    expect(inferSchoolTier('University of Leeds', '第一轮基本招满')).toBe('t2')
    expect(warn).toHaveBeenCalledTimes(2)
  })
})

describe('inferSchoolTier —— 无标注时的兜底', () => {
  it.each([
    'University of Oxford',
    'Imperial College London',
    'National University of Singapore',
    'The University of Hong Kong',
    'University of Toronto',
    'ETH Zurich',
  ])('%s 兜底为 t1', (name) => {
    expect(inferSchoolTier(name, null)).toBe('t1')
  })

  it.each(['University of Leeds', 'Durham University', 'Monash University'])(
    '%s 兜底为 t2',
    (name) => {
      expect(inferSchoolTier(name, null)).toBe('t2')
    },
  )
})

// ════════════════════════════════════════════════════════
// 规则回退
// ════════════════════════════════════════════════════════

const RULES = [
  { region: 'UK', schoolTier: 't1' },
  { region: 'UK', schoolTier: 't2' },
  { region: 'HK', schoolTier: 't2' },
]

describe('findTierRule', () => {
  it('精确命中优先', () => {
    expect(findTierRule(RULES, 'UK', 't1')).toEqual({ region: 'UK', schoolTier: 't1' })
  })

  /**
   * ⚠️ 回退存在的理由:运营可以给某校标 t3(字段本就接受),
   *    但 AdmissionRule 种子表目前只有 t1/t2。没有回退的话该项目会静默消失。
   */
  it('缺失档位就近回退,且偏向更难的一档(不会高估录取率)', () => {
    expect(findTierRule(RULES, 'UK', 't3')).toEqual({ region: 'UK', schoolTier: 't2' })
    expect(findTierRule(RULES, 'HK', 't1')).toEqual({ region: 'HK', schoolTier: 't2' })
  })

  it('距离相同时取更难的那一档', () => {
    const rules = [
      { region: 'UK', schoolTier: 't2' },
      { region: 'UK', schoolTier: 't4' },
    ]
    expect(findTierRule(rules, 'UK', 't3')).toEqual({ region: 'UK', schoolTier: 't2' })
  })

  it('该地区完全没有规则 → undefined(调用方会跳过该项目,而不是编概率)', () => {
    expect(findTierRule(RULES, 'JP', 't1')).toBeUndefined()
  })

  it('未知档位标记不猜', () => {
    expect(findTierRule(RULES, 'UK', '第一轮基本招满')).toBeUndefined()
  })
})

// ════════════════════════════════════════════════════════
// 洞察统计
// ════════════════════════════════════════════════════════

const M = (over: Partial<ProgramMatch> = {}): ProgramMatch => ({
  programId: 'p' + Math.round(Number(over.probabilityHigh ?? 0)),
  schoolName: '示例大学',
  schoolNameEn: 'Example University',
  programName: '示例项目',
  programNameEn: 'Example MSc',
  region: 'UK',
  tier: 'match',
  probabilityLow: 40,
  probabilityHigh: 60,
  gpaRequirement: null,
  verified: true,
  durationMonths: 12,
  tuition: null,
  ieltsRequired: 6.5,
  minBandRequired: null,
  languageStatus: 'meets',
  testRequirement: 'unspecified',
  finalDeadline: null,
  isRolling: false,
  ...over,
})

const iso = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)

describe('buildInsights —— 语言统计的分母', () => {
  /**
   * ⚠️ 分母必须是「官网写明了要求的项目数」,不是命中总数。
   *    用总数当分母会把「官网没写」算成「不达标」,那是在误导用户。
   */
  it('withRequirement 只数官网写明要求的项目', () => {
    const insights = buildInsights(INPUT(), [
      M({ ieltsRequired: 6.5, languageStatus: 'meets' }),
      M({ ieltsRequired: 7.0, languageStatus: 'close' }),
      M({ ieltsRequired: null, languageStatus: 'unknown' }),
    ])
    expect(insights.language.withRequirement).toBe(2)
    expect(insights.language.meets).toBe(1)
    expect(insights.language.close).toBe(1)
    expect(insights.language.below).toBe(0)
  })

  it('要求区间取写明项目的最小/最大值', () => {
    const insights = buildInsights(INPUT(), [
      M({ ieltsRequired: 6.0 }),
      M({ ieltsRequired: 7.5 }),
      M({ ieltsRequired: null }),
    ])
    expect(insights.language.minRequired).toBe(6.0)
    expect(insights.language.maxRequired).toBe(7.5)
  })

  it('一个项目都没写要求时区间为 null,不填 0', () => {
    const insights = buildInsights(INPUT(), [M({ ieltsRequired: null })])
    expect(insights.language.minRequired).toBeNull()
    expect(insights.language.maxRequired).toBeNull()
  })
})

describe('buildInsights —— 时间线', () => {
  /** 给用户看「还有 -20 天」比不给日期糟糕得多,过期的一律不算已公布 */
  it('已过期的截止日不计入 withDeadline', () => {
    const insights = buildInsights(INPUT(), [
      M({ finalDeadline: iso(30) }),
      M({ finalDeadline: iso(-30) }),
      M({ finalDeadline: null }),
    ])
    expect(insights.timeline.withDeadline).toBe(1)
    expect(insights.timeline.pending).toBe(2)
  })

  it('nearest 取最近的一个未来截止日', () => {
    const insights = buildInsights(INPUT(), [
      M({ finalDeadline: iso(90), schoolName: '远的' }),
      M({ finalDeadline: iso(10), schoolName: '近的' }),
    ])
    expect(insights.timeline.nearest?.schoolName).toBe('近的')
  })

  it('全部没有截止日时 nearest 为 null', () => {
    expect(buildInsights(INPUT(), [M()]).timeline.nearest).toBeNull()
  })

  it('统计滚动录取项目数', () => {
    const insights = buildInsights(INPUT(), [M({ isRolling: true }), M({ isRolling: false })])
    expect(insights.timeline.rolling).toBe(1)
  })
})

describe('buildInsights —— 地区与数据质量', () => {
  it('地区分布按数量从多到少排', () => {
    const insights = buildInsights(INPUT(), [
      M({ region: 'HK' }),
      M({ region: 'UK' }),
      M({ region: 'UK' }),
    ])
    expect(insights.regionBreakdown).toEqual([
      { region: 'UK', count: 2 },
      { region: 'HK', count: 1 },
    ])
  })

  /** 数据可信度直接摊开给用户看,不藏 */
  it('已核对 / 未核对分别计数', () => {
    const insights = buildInsights(INPUT(), [
      M({ verified: true }),
      M({ verified: false }),
      M({ verified: false }),
    ])
    expect(insights.dataQuality).toEqual({ verified: 1, unverified: 2 })
  })

  it('GMAT/GRE 档位分布四类都有计数', () => {
    const insights = buildInsights(INPUT(), [
      M({ testRequirement: 'required' }),
      M({ testRequirement: 'recommended' }),
      M({ testRequirement: 'recommended' }),
    ])
    expect(insights.testing).toEqual({
      required: 1,
      recommended: 2,
      not_required: 0,
      unspecified: 0,
    })
  })

  it('空结果不抛错', () => {
    const insights = buildInsights(INPUT(), [])
    expect(insights.regionBreakdown).toEqual([])
    expect(insights.dataQuality).toEqual({ verified: 0, unverified: 0 })
    expect(insights.timeline.nearest).toBeNull()
  })
})
