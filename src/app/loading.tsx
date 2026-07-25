/**
 * 根级加载态。
 *
 * ⚠️ 之前只有 /app 和 /admin 有 loading.tsx,而整条获客漏斗
 *    (首页 → /assess → 结果页 → /pricing)全是服务端渲染 + 数据库查询,
 *    点击之后页面**完全不动**,没有任何反馈。国内访问 + 小机器上,
 *    「点了免费测一测之后好几秒死寂」正是最容易流失的一跳。
 *
 * 做成中性骨架:不猜具体页面结构,只给出「正在加载」的确定信号。
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16" role="status" aria-live="polite">
      <span className="sr-only">正在加载</span>
      <div className="animate-pulse space-y-6">
        <div className="h-8 w-2/3 rounded bg-ink-100" />
        <div className="space-y-3">
          <div className="h-4 w-full rounded bg-ink-100" />
          <div className="h-4 w-5/6 rounded bg-ink-100" />
          <div className="h-4 w-4/6 rounded bg-ink-100" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="h-24 rounded-lg bg-ink-100" />
          <div className="h-24 rounded-lg bg-ink-100" />
          <div className="h-24 rounded-lg bg-ink-100" />
        </div>
      </div>
    </div>
  )
}
