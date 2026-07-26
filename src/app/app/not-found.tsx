import Link from 'next/link'
import { Card } from '@/components/ui'

/**
 * 工作台内的 404。
 *
 * ⚠️ /app 下多个页面会调 notFound()(院校详情、大学总览、文书),但此前
 *    /app 段没有 not-found.tsx,于是落到根级全屏 404 —— 导航栏整个消失,
 *    付费用户被甩出工作台。这和 app/error.tsx 特意保住导航的意图是矛盾的。
 *
 * 文案要说清最常见的原因:地区被撤下、项目下架。用户点的是自己选校单里的东西,
 * 只说「找不到页面」他会以为是系统坏了。
 */
export default function AppNotFound() {
  return (
    <div className="py-6">
      <Card>
        <h1 className="text-lg font-semibold text-ink-900">这个页面暂时打不开</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          最常见的原因是:这个项目已经下架,或者它所在的地区暂时不对外开放
          (通常是我们发现数据有问题、正在重新核对)。
          <br />
          如果它在你的选校单里,先按其他学校推进,数据核对好之后会自动恢复。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/app/schools"
            className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-5 text-sm font-medium text-white hover:bg-brand-700"
          >
            回选校
          </Link>
          <Link
            href="/app/dashboard"
            className="inline-flex min-h-11 items-center rounded-lg border border-ink-200 px-5 text-sm text-ink-700 hover:bg-ink-50"
          >
            回总览
          </Link>
        </div>
      </Card>
    </div>
  )
}
