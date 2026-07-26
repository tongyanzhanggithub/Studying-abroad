'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { markFollowedUp } from './actions'

/** 线索跟进标记 —— 让「待跟进」这个数字能被清掉 */
export function FollowUpToggle({
  leadId,
  followedUp,
}: {
  leadId: string
  followedUp: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            await markFollowedUp(leadId, !followedUp)
            router.refresh()
          } catch {
            /* 失败就保持原状,下次刷新会显示真实状态 */
          }
        })
      }
      className={`rounded px-2 py-0.5 text-xs transition-colors disabled:opacity-50 ${
        followedUp
          ? 'bg-ink-100 text-ink-600 hover:bg-ink-200'
          : 'border border-ink-200 text-ink-600 hover:bg-ink-50'
      }`}
      title={followedUp ? '点击撤销已跟进标记' : '标记为已跟进'}
    >
      {pending ? '…' : followedUp ? '已跟进' : '标记跟进'}
    </button>
  )
}
