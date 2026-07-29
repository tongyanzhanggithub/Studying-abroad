import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { headers } from 'next/headers'
import { track } from '@/lib/analytics'
import { rateLimit } from '@/lib/rate-limit'

/**
 * 分享链接落地页(PRD 9 分享裂变)。
 *
 * 只做一件事:校验分享码 → 记录来源 → 转到评估表单。
 *
 * ⚠️ 这里**不展示分享者的任何信息** —— 被分享者看到的是评估入口,
 *    不是别人的成绩单。分享码无效时也正常放行到评估页,
 *    不给出「该链接无效」这类会让人困惑的报错。
 */
export default async function ReferralLandingPage({
  params,
}: {
  params: Promise<{ shareCode: string }>
}) {
  const { shareCode } = await params

  /**
   * ⚠️ 这是**匿名可访问**的路由,每次访问都会查一次库、可能再写一条埋点。
   *    分享链接天然会被到处转发,正常流量本来就不可控;而一个循环 curl
   *    同样能把 AnalyticsEvent 表灌满,顺带每次都打一次 Lead 的唯一索引查询。
   *
   *    重定向本身照常执行 —— 被限流的只是**埋点**。
   *    真实用户在任何情况下都该被正常送到评估页,这是获客路径,
   *    不能因为防刷把人挡在门外。
   */
  const ip = (await headers()).get('x-real-ip') || 'unknown'
  const countable = rateLimit(`referral:${ip}`, 30, 60_000).allowed

  // 分享码是 cuid(25 字符),超长的一律不查库 —— 省掉一次索引查询
  if (shareCode.length > 64) redirect('/assess?ch=share')

  const referrer = await db.lead.findUnique({
    where: { shareCode },
    select: { id: true },
  })

  if (referrer) {
    if (countable) {
      await track('referral_link_opened', {
        properties: { referrerLeadId: referrer.id, shareCode },
      })
    }
    redirect(`/assess?ref=${encodeURIComponent(shareCode)}&ch=share`)
  }

  redirect('/assess?ch=share')
}
