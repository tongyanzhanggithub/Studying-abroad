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
  //   ⚠️ created,不是 sent:通知只是落库(pending),渠道未接入前并未真正发出。
  //   接入真实渠道、deliver() 确实投递成功后,再另打一个 notification_delivered。
  | 'notification_created'
  | 'notification_clicked'

export interface TrackOptions {
  userId?: string | null
  anonymousId?: string | null
  sourceChannel?: string | null
  properties?: Record<string, unknown>
}

/**
 * 写入前的体积上限。
 *
 * ⚠️ 这是防滥用的**关键一道**,而且必须放在这里、不能只放在各调用方。
 *
 *    trackAssessStart / trackShare 是**不需要登录**的 server action,
 *    而它们把调用方传进来的字符串原样塞进 sourceChannel 和 properties ——
 *    这两个字段在 schema 里是没有长度上限的 TEXT。
 *    也就是说 `trackShare('A'.repeat(10_000_000))` 就是一行 10 MB,
 *    几百次调用就是几个 GB,而 Postgres 和应用在同一台 2 核机器上。
 *
 *    在写入口封顶,所有调用方(包括以后新增的)一次覆盖 ——
 *    指望每个 action 各自校验,迟早会漏。
 */
const MAX_SOURCE_CHANNEL = 64
const MAX_ANONYMOUS_ID = 64
/** properties 序列化后的字节上限 —— 埋点是给漏斗看的,不是日志存储 */
const MAX_PROPERTIES_BYTES = 2048

function clampString(v: string | null | undefined, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

/**
 * properties 超限时**整体丢弃并留标记**,而不是截断。
 * 截断会产生半截 JSON —— 分析时更难发现数据是坏的;
 * 一个明确的 _dropped 标记反而能让人一眼看出这里发生过什么。
 */
function clampProperties(p: Record<string, unknown> | undefined): object {
  if (!p) return {}
  let json: string
  try {
    json = JSON.stringify(p)
  } catch {
    return { _dropped: 'unserializable' }
  }
  if (json.length > MAX_PROPERTIES_BYTES) {
    return { _dropped: 'too_large', _size: json.length }
  }
  return p as object
}

/**
 * 埋点写入绝不能影响主流程 —— 失败只记日志,不向上抛。
 */
export async function track(name: AnalyticsEventName, opts: TrackOptions = {}) {
  try {
    await db.analyticsEvent.create({
      data: {
        // name 是联合类型,不接受任意字符串 —— 天然是白名单
        name,
        userId: opts.userId ?? null,
        anonymousId: clampString(opts.anonymousId, MAX_ANONYMOUS_ID),
        sourceChannel: clampString(opts.sourceChannel, MAX_SOURCE_CHANNEL),
        properties: clampProperties(opts.properties),
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
