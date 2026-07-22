'use server'

import { track } from '@/lib/analytics'

/** 分享动作埋点(PRD 11.2 必埋事件 assess_share) */
export async function trackShare(shareCode: string) {
  await track('assess_share', { properties: { shareCode } })
}
