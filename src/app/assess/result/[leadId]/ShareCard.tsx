'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui'
import { trackShare } from './share-actions'

/**
 * 分享裂变(PRD 9 P0)。
 *
 * 机制:分享自己的定位结果 → 被分享者完成评估 → 分享者解锁 1 所附加院校推荐。
 *
 * ⚠️ 分享出去的内容**不包含手机号、GPA、语言成绩**等个人信息 ——
 *    只带一个分享码。被分享者点开看到的是「测测你能申哪些学校」的落地页,
 *    不是分享者的成绩单。裂变不能以泄露用户隐私为代价。
 */
export function ShareCard({
  shareCode,
  referralCount,
  unlockedCount,
  poolRemaining,
  siteUrl,
}: {
  shareCode: string
  /** 已成功邀请到的完成评估人数 */
  referralCount: number
  /** 已因此解锁的院校数 */
  unlockedCount: number
  /** 候补池里还剩多少可解锁 */
  poolRemaining: number
  siteUrl: string
}) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const [, startTransition] = useTransition()

  const shareUrl = `${siteUrl}/r/${shareCode}`
  const hasUnlocked = unlockedCount > 0

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(
        `我用 Compass 测了下非美英语授课商科项目的选校定位,数据都带官网来源。你也测测:${shareUrl}`,
      )
      setCopied(true)
      setTimeout(() => setCopied(false), 2400)
      startTransition(async () => {
        await trackShare(shareCode)
        router.refresh()
      })
    } catch {
      // 剪贴板不可用(HTTP 环境或权限被拒)时,退化为让用户手动复制
      setCopied(false)
      window.prompt('复制这个链接分享给朋友:', shareUrl)
    }
  }

  return (
    <Card>
      <h2 className="font-medium text-ink-900">
        {hasUnlocked ? `已解锁 ${unlockedCount} 所附加院校` : '分享解锁更多院校'}
      </h2>

      <p className="mt-2 text-sm leading-relaxed text-ink-600">
        {hasUnlocked ? (
          <>
            {referralCount} 位朋友通过你的链接完成了评估,
            为你解锁了 {unlockedCount} 所院校 —— 在上方冲刺档里带「分享解锁」标记。
            {poolRemaining > 0 && <> 再邀请 1 位可以再多解锁 1 所。</>}
          </>
        ) : (
          <>
            把你的定位结果分享给同样在申请的朋友,
            每有 1 位完成评估,你就多解锁 1 所院校推荐。
          </>
        )}
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <button
          onClick={handleCopy}
          className="min-h-11 rounded-lg border border-brand-500 px-4 py-2 text-sm text-brand-700 hover:bg-brand-50 sm:min-h-0"
        >
          {copied ? '链接已复制' : '复制分享链接'}
        </button>
        <span className="text-xs break-all text-ink-400">{shareUrl}</span>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-ink-400">
        分享链接里只有一个随机分享码,不包含你的手机号、成绩或任何个人信息。
        朋友点开看到的是评估入口,不是你的结果。
      </p>
    </Card>
  )
}
