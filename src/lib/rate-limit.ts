import 'server-only'

/**
 * 进程内滑动窗口限流。
 *
 * ── 为什么不查数据库 ──────────────────────────────────
 *
 * 免费评估那道闸门查 Lead 表是合适的:它本来就要写库,多一次 count 不算什么,
 * 而且**必须跨重启生效**(灌库是持久伤害)。
 *
 * 但埋点类的匿名接口(trackAssessStart / trackShare)不一样 ——
 * 为了拦住一个只写一行小记录的请求,先去查一次库,等于自己制造了要防的那个负载。
 * 这类地方用进程内计数才对。
 *
 * ⚠️ 诚实说明边界:
 *   · 进程重启即清零 —— 对「持续刷」有效,对「重启后再刷」无效。
 *     可以接受:这里防的是把库刷爆,不是防止个位数的多余记录。
 *   · 多进程/多实例下每个进程各算各的。当前是 systemd 单进程
 *     (见 deploy/compass.service),成立;将来上多实例要换成 Redis。
 *   · 内存占用有上限:超过 MAX_KEYS 会整体清空,不会无限增长 ——
 *     否则限流器自己就成了内存耗尽的入口。
 */

interface Bucket {
  hits: number[]
}

const buckets = new Map<string, Bucket>()

/** 键的数量上限。攻击者换 IP 刷键同样是一种攻击,必须封顶 */
const MAX_KEYS = 10_000

export interface RateLimitResult {
  allowed: boolean
  /** 窗口内已用次数,便于打日志 */
  count: number
}

/**
 * @param key       限流键(通常是 `动作:IP`)
 * @param limit     窗口内允许的次数
 * @param windowMs  窗口长度
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()

  /**
   * ⚠️ 键太多时整体清空,而不是拒绝服务。
   *    攻击者伪造大量键能把 Map 撑爆 —— 那就从「刷库」变成「刷内存」,
   *    换了个方式达到同样目的。清空的代价只是短暂放宽限流,
   *    比进程 OOM 好得多。
   */
  if (buckets.size > MAX_KEYS) buckets.clear()

  const b = buckets.get(key) ?? { hits: [] }
  const cutoff = now - windowMs
  // 只保留窗口内的时间戳 —— 顺带完成了过期清理,不需要单独的定时器
  b.hits = b.hits.filter((t) => t > cutoff)

  if (b.hits.length >= limit) {
    buckets.set(key, b)
    return { allowed: false, count: b.hits.length }
  }

  b.hits.push(now)
  buckets.set(key, b)
  return { allowed: true, count: b.hits.length }
}

/** 仅供测试使用 —— 清掉进程内状态,避免用例互相影响 */
export function __resetRateLimit() {
  buckets.clear()
}
