/**
 * 情境化推荐引擎的触发条件 DSL。
 *
 * 存在 RecommendationRule.trigger 这个 Json 列里,运营在后台配置,
 * 代码里**只实现求值器,不硬编码任何一条规则**(PRD 4.7)。
 */

export type TriggerCondition =
  /** 选校单中某档位的数量达到阈值。例:冲刺档 ≥2 所 */
  | { type: 'school_tier_count'; tier: 'reach' | 'match' | 'safe'; gte: number }
  /** 文书润色轮次达到阈值。例:进入第 3 轮润色 */
  | { type: 'essay_polish_round'; gte: number }
  /** 距最近截止日不足 N 天,且文书未终稿 */
  | { type: 'deadline_approaching'; withinDays: number; essayNotFinal?: boolean }
  /** 任一院校状态变为指定值。例:面试邀请 */
  | { type: 'application_status'; status: string }
  /** GPA 低于阈值(百分制) */
  | { type: 'gpa_below'; value: number }
  /** 转专业标记 */
  | { type: 'major_switch' }
  /** 已购单点服务数量达到阈值 */
  | { type: 'purchased_service_count'; gte: number }

export interface TriggerSpec {
  /** all = 全部满足;any = 任一满足 */
  op: 'all' | 'any'
  conditions: TriggerCondition[]
}

/** 求值时可用的上下文,由 buildContext 一次性组装 */
export interface RecommendationContext {
  userId: string
  gpa100: number | null
  isMajorSwitch: boolean
  tierCounts: { reach: number; match: number; safe: number }
  maxEssayPolishRound: number
  hasUnfinishedEssay: boolean
  daysToNearestDeadline: number | null
  applicationStatuses: string[]
  purchasedServiceCount: number
  /** 用于文案占位符 {school} */
  interviewSchoolName: string | null
}

/** 渲染给前端的推荐卡 */
export interface RecommendationCard {
  ruleId: string
  ruleCode: string
  placement: string
  copy: string
  sku: {
    id: string
    name: string
    priceCents: number
    slaHours: number
  }
}
