import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser, getActiveSubscription } from '@/lib/auth/session'
import { logout } from '@/app/login/actions'
import { BrandLogo } from '@/components/BrandLogo'
import { MobileTabBar } from './MobileTabBar'

/**
 * 付费工作台外壳。
 * /app 下所有页面都要求登录 + 有效季票(onboarding 除外,它在支付后立即可达)。
 */

const NAV = [
  { href: '/app/dashboard', label: '总览' },
  { href: '/app/assessments', label: '评估' },
  { href: '/app/schools', label: '选校' },
  { href: '/app/materials', label: '材料' },
  { href: '/app/essays', label: '文书' },
  { href: '/app/services', label: '服务' },
  { href: '/app/orders', label: '订单' },
  { href: '/app/settings', label: '设置' },
]

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/app/dashboard')

  const subscription = await getActiveSubscription(user.id)
  if (!subscription) redirect('/pricing')

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <div className="flex items-center gap-6">
            <BrandLogo href="/app/dashboard" />
            <nav className="hidden gap-5 text-sm text-ink-600 sm:flex">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-ink-900">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-xs text-ink-400 sm:inline">
              {subscription.plan.name}
            </span>
            <form action={logout}>
              <button className="text-ink-600 hover:text-ink-900">退出</button>
            </form>
          </div>
        </div>

      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>

      {/* 移动端底部标签栏(桌面隐藏)*/}
      <MobileTabBar />
    </div>
  )
}
