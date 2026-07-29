'use server'

import { headers } from 'next/headers'
import { track } from '@/lib/analytics'
import { rateLimit } from '@/lib/rate-limit'

/**
 * 分享动作埋点(PRD 11.2 必埋事件 assess_share)。
 *
 * ⚠️ 这是**不需要登录**的写接口。两道防护缺一不可:
 *      · 长度上限 —— shareCode 会进 properties,而那个字段是无上限的 TEXT。
 *        真实的 shareCode 是 cuid(25 字符),截到 64 足够,
 *        同时挡住 `trackShare('A'.repeat(1e7))` 这种一行 10 MB 的写法。
 *        (写入口 lib/analytics.ts 里还有一道整体封顶,这里是就近的第一道。)
 *      · 频次上限 —— 否则一个循环就能把 AnalyticsEvent 表灌满。
 */
const MAX_SHARE_CODE = 64
const PER_IP_PER_MINUTE = 20

export async function trackShare(shareCode: string) {
  const ip = (await headers()).get('x-real-ip') || 'unknown'
  const gate = rateLimit(`share:${ip}`, PER_IP_PER_MINUTE, 60_000)
  // 埋点被限流不告诉调用方,也不报错 —— 它对用户的操作没有任何影响
  if (!gate.allowed) return

  await track('assess_share', {
    properties: { shareCode: String(shareCode ?? '').slice(0, MAX_SHARE_CODE) },
  })
}
