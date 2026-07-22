import 'server-only'
import { db } from '@/lib/db'

/**
 * 自建埋点(PRD 7.2:第 1 天接入,别急着上三方)。
 * 事件名清单严格对应 PRD 11.2,新增事件请同步更新此联合类型,
 * 让漏斗看板的口径不会漂。
 */
export type AnalyticsEventName =
  // 获客漏斗
  | 'assess_start'
  | 'assess_complete'
  | 'assess_share'
  // 分享裂变(PRD 9):打开分享链接 → 完成评估形成转化
  | 'referral_link_opened'
  | 'assess_share_converted'
  | 'pricing_view'
  | 'pay_success'
  // 激活
  | 'onboarding_complete'
  | 'school_added'
  | 'material_done'
  | 'essay_ai_session'
  | 'essay_final'
  // 增值转化
  | 'rec_card_shown'
  | 'rec_card_clicked'
  | 'rec_card_dismissed'
  | 'service_pay_success'
  // 触达
  | 'notification_sent'
  | 'notification_clicked'

export interface TrackOptions {
  userId?: string | null
  anonymousId?: string | null
  sourceChannel?: string | null
  properties?: Record<string, unknown>
}

/**
 * 埋点写入绝不能影响主流程 —— 失败只记日志,不向上抛。
 */
export async function track(name: AnalyticsEventName, opts: TrackOptions = {}) {
  try {
    await db.analyticsEvent.create({
      data: {
        name,
        userId: opts.userId ?? null,
        anonymousId: opts.anonymousId ?? null,
        sourceChannel: opts.sourceChannel ?? null,
        properties: (opts.properties ?? {}) as object,
      },
    })
  } catch (err) {
    console.error(`[analytics] 事件 ${name} 写入失败`, err)
  }
}

/** 漏斗计数,供后台看板使用 */
export async function countEvents(
  name: AnalyticsEventName,
  since: Date,
): Promise<number> {
  return db.analyticsEvent.count({ where: { name, createdAt: { gte: since } } })
}

/** 去重用户数 —— 漏斗按人计算而非按次 */
export async function countDistinctUsers(
  name: AnalyticsEventName,
  since: Date,
): Promise<number> {
  const rows = await db.analyticsEvent.findMany({
    where: { name, createdAt: { gte: since }, userId: { not: null } },
    select: { userId: true },
    distinct: ['userId'],
  })
  return rows.length
}
