import { describe, it, expect } from 'vitest'
import { evalCondition, evalTrigger, resolveN } from './engine'
import type { RecommendationContext, TriggerSpec } from './types'

const CTX = (over: Partial<RecommendationContext> = {}): RecommendationContext => ({
  userId: 'u1',
  gpa100: 85,
  isMajorSwitch: false,
  tierCounts: { reach: 0, match: 0, safe: 0 },
  maxEssayPolishRound: 0,
  hasUnfinishedEssay: false,
  daysToNearestDeadline: null,
  applicationStatuses: [],
  purchasedServiceCount: 0,
  interviewSchoolName: null,
  ...over,
})

// ════════════════════════════════════════════════════════
// 单条件
// ════════════════════════════════════════════════════════

describe('evalCondition —— 选校档位数量', () => {
  it('达到阈值才成立', () => {
    const ctx = CTX({ tierCounts: { reach: 2, match: 1, safe: 0 } })
    expect(evalCondition({ type: 'school_tier_count', tier: 'reach', gte: 2 }, ctx)).toBe(true)
    expect(evalCondition({ type: 'school_tier_count', tier: 'reach', gte: 3 }, ctx)).toBe(false)
  })

  it('分档互不串味', () => {
    const ctx = CTX({ tierCounts: { reach: 5, match: 0, safe: 0 } })
    expect(evalCondition({ type: 'school_tier_count', tier: 'match', gte: 1 }, ctx)).toBe(false)
  })
})

describe('evalCondition —— 文书润色轮次', () => {
  it('取最大轮次比阈值', () => {
    expect(
      evalCondition({ type: 'essay_polish_round', gte: 3 }, CTX({ maxEssayPolishRound: 3 })),
    ).toBe(true)
    expect(
      evalCondition({ type: 'essay_polish_round', gte: 3 }, CTX({ maxEssayPolishRound: 2 })),
    ).toBe(false)
  })
})

describe('evalCondition —— 截止日临近', () => {
  /** 没有任何已知截止日时不能触发 —— 否则「还有 0 天」的紧迫文案会对所有人弹 */
  it('没有截止日信息时不成立', () => {
    expect(
      evalCondition(
        { type: 'deadline_approaching', withinDays: 14 },
        CTX({ daysToNearestDeadline: null }),
      ),
    ).toBe(false)
  })

  it('在窗口内才成立', () => {
    const near = CTX({ daysToNearestDeadline: 10 })
    expect(evalCondition({ type: 'deadline_approaching', withinDays: 14 }, near)).toBe(true)
    expect(evalCondition({ type: 'deadline_approaching', withinDays: 7 }, near)).toBe(false)
  })

  it('边界值(恰好等于窗口)算成立', () => {
    expect(
      evalCondition(
        { type: 'deadline_approaching', withinDays: 14 },
        CTX({ daysToNearestDeadline: 14 }),
      ),
    ).toBe(true)
  })

  it('essayNotFinal 为真时还要求确实有未完成文书', () => {
    const base = { type: 'deadline_approaching', withinDays: 14, essayNotFinal: true } as const
    expect(
      evalCondition(base, CTX({ daysToNearestDeadline: 5, hasUnfinishedEssay: true })),
    ).toBe(true)
    expect(
      evalCondition(base, CTX({ daysToNearestDeadline: 5, hasUnfinishedEssay: false })),
    ).toBe(false)
  })
})

describe('evalCondition —— 其余条件', () => {
  it('申请状态命中任一即可', () => {
    const ctx = CTX({ applicationStatuses: ['submitted', 'interview_invited'] })
    expect(evalCondition({ type: 'application_status', status: 'interview_invited' }, ctx)).toBe(true)
    expect(evalCondition({ type: 'application_status', status: 'admitted' }, ctx)).toBe(false)
  })

  it('GPA 低于阈值', () => {
    expect(evalCondition({ type: 'gpa_below', value: 80 }, CTX({ gpa100: 79 }))).toBe(true)
    expect(evalCondition({ type: 'gpa_below', value: 80 }, CTX({ gpa100: 80 }))).toBe(false)
  })

  /** ⚠️ GPA 未知不能当成「低于阈值」—— 那会把没填资料的人全部命中 */
  it('GPA 未知时不成立', () => {
    expect(evalCondition({ type: 'gpa_below', value: 80 }, CTX({ gpa100: null }))).toBe(false)
  })

  it('转专业标记', () => {
    expect(evalCondition({ type: 'major_switch' }, CTX({ isMajorSwitch: true }))).toBe(true)
    expect(evalCondition({ type: 'major_switch' }, CTX({ isMajorSwitch: false }))).toBe(false)
  })

  it('已购服务数', () => {
    expect(
      evalCondition({ type: 'purchased_service_count', gte: 1 }, CTX({ purchasedServiceCount: 1 })),
    ).toBe(true)
  })

  /** 后台可以配出代码还不认识的条件类型 —— 必须判 false,不能默认放行 */
  it('未知条件类型判 false', () => {
    expect(
      evalCondition({ type: 'not_a_real_condition' } as never, CTX({ gpa100: 50 })),
    ).toBe(false)
  })
})

// ════════════════════════════════════════════════════════
// 组合
// ════════════════════════════════════════════════════════

describe('evalTrigger', () => {
  const ctx = CTX({ tierCounts: { reach: 3, match: 0, safe: 0 }, isMajorSwitch: true })

  it('all:全部满足才成立', () => {
    expect(
      evalTrigger(
        {
          op: 'all',
          conditions: [
            { type: 'school_tier_count', tier: 'reach', gte: 2 },
            { type: 'major_switch' },
          ],
        },
        ctx,
      ),
    ).toBe(true)

    expect(
      evalTrigger(
        {
          op: 'all',
          conditions: [
            { type: 'school_tier_count', tier: 'reach', gte: 2 },
            { type: 'gpa_below', value: 60 },
          ],
        },
        ctx,
      ),
    ).toBe(false)
  })

  it('any:任一满足即成立', () => {
    expect(
      evalTrigger(
        {
          op: 'any',
          conditions: [
            { type: 'gpa_below', value: 60 },
            { type: 'major_switch' },
          ],
        },
        ctx,
      ),
    ).toBe(true)
  })

  /**
   * ⚠️ 空条件必须判 false。
   *    如果按 `every` 的数学惯例返回 true,后台一条配错(条件列表存成空数组)的规则
   *    就会**对所有用户无条件弹卡** —— 与 PRD「克制是长期信任的一部分」正面冲突。
   */
  it('空条件列表判 false,不是无条件命中', () => {
    expect(evalTrigger({ op: 'all', conditions: [] }, ctx)).toBe(false)
    expect(evalTrigger({ op: 'any', conditions: [] }, ctx)).toBe(false)
    expect(evalTrigger({ op: 'all' } as unknown as TriggerSpec, ctx)).toBe(false)
  })
})

// ════════════════════════════════════════════════════════
// 文案里的 {n}
// ════════════════════════════════════════════════════════

describe('resolveN —— {n} 的含义必须跟着规则自己的条件走', () => {
  const ctx = CTX({
    tierCounts: { reach: 4, match: 2, safe: 1 },
    purchasedServiceCount: 7,
    maxEssayPolishRound: 3,
    daysToNearestDeadline: 9,
  })

  /**
   * ⚠️ 原来用的是统一兜底链(a || b || c),于是「已购 {n} 项服务」会显示成冲刺院校数 ——
   *    文案本身没错,数字却是另一件事的,用户只会觉得这个产品在乱说。
   */
  it('规则讲冲刺档 → {n} 是冲刺数', () => {
    expect(resolveN({ op: 'all', conditions: [{ type: 'school_tier_count', tier: 'reach', gte: 2 }] }, ctx)).toBe(4)
  })

  it('规则讲已购服务 → {n} 是已购数', () => {
    expect(resolveN({ op: 'all', conditions: [{ type: 'purchased_service_count', gte: 1 }] }, ctx)).toBe(7)
  })

  it('规则讲润色轮次 → {n} 是轮次', () => {
    expect(resolveN({ op: 'all', conditions: [{ type: 'essay_polish_round', gte: 2 }] }, ctx)).toBe(3)
  })

  it('规则讲截止日 → {n} 是剩余天数', () => {
    expect(resolveN({ op: 'all', conditions: [{ type: 'deadline_approaching', withinDays: 14 }] }, ctx)).toBe(9)
  })

  it('多条件时取第一个有数量含义的', () => {
    expect(
      resolveN(
        {
          op: 'all',
          conditions: [
            { type: 'major_switch' },
            { type: 'purchased_service_count', gte: 1 },
            { type: 'school_tier_count', tier: 'reach', gte: 1 },
          ],
        },
        ctx,
      ),
    ).toBe(7)
  })

  it('没有任何数量类条件时返回 0', () => {
    expect(resolveN({ op: 'all', conditions: [{ type: 'major_switch' }] }, ctx)).toBe(0)
    expect(resolveN({ op: 'all', conditions: [] }, ctx)).toBe(0)
  })

  it('截止日未知时按 0 天算,不返回 null', () => {
    expect(
      resolveN(
        { op: 'all', conditions: [{ type: 'deadline_approaching', withinDays: 14 }] },
        CTX({ daysToNearestDeadline: null }),
      ),
    ).toBe(0)
  })
})
