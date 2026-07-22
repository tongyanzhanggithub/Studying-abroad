import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { track } from '@/lib/analytics'

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

  const referrer = await db.lead.findUnique({
    where: { shareCode },
    select: { id: true },
  })

  if (referrer) {
    await track('referral_link_opened', {
      properties: { referrerLeadId: referrer.id, shareCode },
    })
    redirect(`/assess?ref=${encodeURIComponent(shareCode)}&ch=share`)
  }

  redirect('/assess?ch=share')
}
