import { Card } from '@/components/ui'

/**
 * 工作台切页时的骨架屏。
 *
 * ⚠️ 没有它的时候,点「选校」之后页面**完全不动** —— 因为这些页面是
 *    服务端渲染的,要等数据库查完(还要跑 syncApplicationStatuses /
 *    regenerateMaterials / buildActionPlan)才会整页替换。
 *    本地几十毫秒看不出来,国内访问海外服务器就是好几秒的死寂,
 *    用户会以为没点上,然后再点一次。
 *
 * 骨架屏不是为了好看,是为了回答「我点的那一下,系统收到了吗」。
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-32 animate-pulse rounded-lg bg-ink-100" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i}>
            <div className="h-3 w-16 animate-pulse rounded bg-ink-100" />
            <div className="mt-2 h-7 w-14 animate-pulse rounded bg-ink-100" />
          </Card>
        ))}
      </div>

      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Card key={i}>
            <div className="h-4 w-40 animate-pulse rounded bg-ink-100" />
            <div className="mt-2 h-3 w-64 max-w-full animate-pulse rounded bg-ink-100" />
          </Card>
        ))}
      </div>

      <p className="text-center text-xs text-ink-400">加载中…</p>
    </div>
  )
}
