import { Card } from '@/components/ui'

/** 后台切页骨架屏 —— 院校库、派单这些页面查询量不小 */
export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="h-8 w-40 animate-pulse rounded-lg bg-ink-100" />
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <div className="h-4 w-52 max-w-full animate-pulse rounded bg-ink-100" />
            <div className="mt-2 h-3 w-72 max-w-full animate-pulse rounded bg-ink-100" />
          </Card>
        ))}
      </div>
      <p className="text-center text-xs text-ink-400">加载中…</p>
    </div>
  )
}
