import { describe, it, expect } from 'vitest'
import {
  DIRECTION_QS_SUBJECT,
  KNOWN_QS_SUBJECTS,
  qsSubjectByName,
  qsSubjectOf,
} from './qs-subjects'
import { formatRanking, rankingSortValue } from './ranking'
import type { Direction } from '@prisma/client'

/** schema 里 Direction 的全部取值 —— 少一个就说明映射表漏了 */
const ALL_DIRECTIONS: Direction[] = [
  'finance', 'accounting', 'management', 'marketing', 'business_analytics',
  'economics', 'international_business', 'supply_chain', 'hr',
  'computer_science', 'data_science_ai', 'engineering', 'architecture',
  'mathematics_statistics', 'natural_sciences', 'life_sciences_medicine',
  'social_sciences', 'media_communication', 'law_public_policy', 'education',
  'arts_design', 'humanities', 'environment_sustainability',
  'agriculture_food_science', 'hospitality_tourism', 'public_health', 'other',
]

describe('DIRECTION_QS_SUBJECT —— 覆盖完整', () => {
  /**
   * ⚠️ 新增一个 Direction 却忘了配学科映射,后果是**那个方向的项目
   *    永远显示不出学科排名**,而且不报错。这条用例就是为了让它报错。
   */
  it('每个 Direction 都在映射表里(缺一个就转红)', () => {
    for (const d of ALL_DIRECTIONS) {
      expect(Object.hasOwn(DIRECTION_QS_SUBJECT, d), `缺少方向:${d}`).toBe(true)
    }
    expect(Object.keys(DIRECTION_QS_SUBJECT).sort()).toEqual([...ALL_DIRECTIONS].sort())
  })

  it('除 other 外都映射到了一个学科', () => {
    for (const d of ALL_DIRECTIONS) {
      if (d === 'other') continue
      expect(qsSubjectOf(d), `方向 ${d} 没有学科`).not.toBeNull()
    }
  })

  /**
   * 「其它方向」是兜底分类,里面什么都可能有 ——
   * 随便挂一个学科名次上去,等于给用户一个和他项目无关的数字。
   */
  it('other 刻意不映射,宁可不显示', () => {
    expect(qsSubjectOf('other')).toBeNull()
  })

  it('不认识的方向返回 null,不猜', () => {
    expect(qsSubjectOf('quantum_alchemy')).toBeNull()
  })
})

describe('DIRECTION_QS_SUBJECT —— 归并关系', () => {
  /** QS 榜上没有「国际商务」「供应链」这些细分榜,它们都归商科与管理 */
  it.each(['management', 'business_analytics', 'international_business', 'supply_chain', 'hr'])(
    '%s 归到 Business & Management Studies',
    (d) => {
      expect(qsSubjectOf(d)?.subject).toBe('Business & Management Studies')
    },
  )

  it('金融与会计共用 Accounting & Finance', () => {
    expect(qsSubjectOf('finance')?.subject).toBe('Accounting & Finance')
    expect(qsSubjectOf('accounting')?.subject).toBe('Accounting & Finance')
  })

  /**
   * ⚠️ broad 标记必须准确 —— 页面靠它决定要不要标「大类」。
   *    「工程与技术大类第 20」和「机械工程第 20」含金量差很远,
   *    标错等于把一个大类名次冒充成细分专业名次。
   */
  it.each(['engineering', 'natural_sciences', 'life_sciences_medicine', 'social_sciences', 'humanities'])(
    '%s 取的是 QS 大类,必须标 broad',
    (d) => {
      expect(qsSubjectOf(d)?.broad).toBe(true)
    },
  )

  it.each(['finance', 'computer_science', 'marketing', 'education', 'public_health'])(
    '%s 有细分学科榜,不是大类',
    (d) => {
      expect(qsSubjectOf(d)?.broad).toBe(false)
    },
  )
})

describe('qsSubjectByName —— 反查', () => {
  it('按 QS 原文查得到展示信息', () => {
    expect(qsSubjectByName('Accounting & Finance')?.label).toBe('会计与金融')
    expect(qsSubjectByName('Engineering & Technology')?.broad).toBe(true)
  })

  /**
   * ⚠️ 大小写和 & 必须严格一致。导入脚本靠 KNOWN_QS_SUBJECTS 比对来告警,
   *    因为拼错的后果是「项目按 direction 查不到自己的名次」—— 悄悄查不到。
   */
  it('拼写不一致查不到(这正是导入时要告警的情形)', () => {
    expect(qsSubjectByName('Accounting and Finance')).toBeNull()
    expect(qsSubjectByName('accounting & finance')).toBeNull()
  })

  it('库里出现表外学科时返回 null,由调用方原样显示英文', () => {
    expect(qsSubjectByName('Dentistry')).toBeNull()
  })
})

describe('KNOWN_QS_SUBJECTS', () => {
  it('去重且排序', () => {
    expect(new Set(KNOWN_QS_SUBJECTS).size).toBe(KNOWN_QS_SUBJECTS.length)
    expect([...KNOWN_QS_SUBJECTS].sort()).toEqual(KNOWN_QS_SUBJECTS)
  })

  it('包含商科与管理(五个方向共用的那个)', () => {
    expect(KNOWN_QS_SUBJECTS).toContain('Business & Management Studies')
  })
})

describe('formatRanking —— 学科名要写出来', () => {
  /**
   * ⚠️ 早先统一渲染成「QS 2027 专业 #12」,用户没法判断这个 12 是
   *    「会计与金融第 12」还是「工程与技术大类第 12」。
   */
  it('带学科名时写学科名,不写「专业」', () => {
    const text = formatRanking(
      'qs',
      { provider: 'qs', year: 2027, rank: 12, subjectName: '会计与金融' },
      'subject',
    )
    expect(text).toBe('QS 2027 会计与金融 #12')
  })

  it('没有学科名才退回「专业」', () => {
    expect(formatRanking('qs', { provider: 'qs', year: 2027, rank: 12 }, 'subject')).toBe(
      'QS 2027 专业 #12',
    )
  })

  it('综合排名不受影响', () => {
    expect(
      formatRanking('qs', { provider: 'qs', year: 2027, rank: 4, subjectName: '会计与金融' }, 'overall'),
    ).toBe('QS 2027 综合 #4')
  })

  it('区间名次用 rank_text 原文', () => {
    expect(
      formatRanking(
        'qs',
        { provider: 'qs', year: 2026, rank: null, rankText: '151-200', subjectName: '数学' },
        'subject',
      ),
    ).toBe('QS 2026 数学 151-200')
  })

  it('既没有名次也没有原文时不产出文案', () => {
    expect(formatRanking('qs', { provider: 'qs', year: 2026, rank: null }, 'subject')).toBeNull()
  })
})

describe('rankingSortValue —— 区间名次也要参与排序', () => {
  it('确切名次按名次排', () => {
    expect(rankingSortValue({ provider: 'qs', rank: 21 })).toBe(21)
  })

  /**
   * ⚠️ QS 学科榜过了前 100 名只给区间。库里 192 条学科名次有 48 条是区间,
   *    全按「无名次」处理的话,101-150 的学校会排在 601-650 后面(两者都是 MAX),
   *    用户选了「专业排名优先」却看到乱序 —— 不报错、结果悄悄是错的。
   */
  it('区间按下界排', () => {
    expect(rankingSortValue({ provider: 'qs', rank: null, rankText: '101-150' })).toBe(101)
    expect(rankingSortValue({ provider: 'qs', rank: null, rankText: '601-650' })).toBe(601)
  })

  it('区间之间的相对次序正确', () => {
    const a = rankingSortValue({ provider: 'qs', rank: null, rankText: '101-150' })
    const b = rankingSortValue({ provider: 'qs', rank: null, rankText: '601-650' })
    expect(a).toBeLessThan(b)
  })

  it('确切名次仍然排在区间前面', () => {
    const exact = rankingSortValue({ provider: 'qs', rank: 99 })
    const range = rankingSortValue({ provider: 'qs', rank: null, rankText: '101-150' })
    expect(exact).toBeLessThan(range)
  })

  it('真的没有名次才排到最后', () => {
    expect(rankingSortValue(null)).toBe(Number.MAX_SAFE_INTEGER)
    expect(rankingSortValue({ provider: 'qs', rank: null })).toBe(Number.MAX_SAFE_INTEGER)
    expect(rankingSortValue({ provider: 'qs', rank: null, rankText: '未收录' })).toBe(
      Number.MAX_SAFE_INTEGER,
    )
  })
})
