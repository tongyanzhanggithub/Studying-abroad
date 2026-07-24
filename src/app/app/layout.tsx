import { redirect } from 'next/navigation'
import { getCurrentUser, getActiveSubscription } from '@/lib/auth/session'
import { logout } from '@/app/login/actions'
import { BrandLogo } from '@/components/BrandLogo'
import { MobileTabBar } from './MobileTabBar'
import { DesktopAppNav } from './DesktopAppNav'

/**
 * 付费工作台外壳。
 * /app 下所有页面都要求登录 + 有效季票(onboarding 除外,它在支付后立即可达)。
 */

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/app/dashboard')

  const subscription = await getActiveSubscription(user.id)
  if (!subscription) redirect('/pricing')

  return (
    <div className="min-h-screen bg-[#f7f8fb]">
      <header className="sticky top-0 z-30 border-b border-ink-100 bg-white/86 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2.5 sm:px-5 sm:py-3">
          {/*
            logo 回首页,不是回工作台首页。
            「点 logo 回站点首页」是极强的通用惯例,指向 /app/dashboard 的话,
            在总览页点它等于原地打转;而且工作台里原本没有任何出口能回到
            营销站(定价、用户协议、隐私政策、FAQ 都在那边)。
            回工作台有下面导航里的「总览」,不缺这一个入口。
          */}
          <BrandLogo href="/" />
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 sm:inline">
              {subscription.plan.name}
            </span>
            <form action={logout}>
              <button className="rounded-lg px-3 py-2 text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900">
                退出
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-4 sm:grid-cols-[224px_minmax(0,1fr)] sm:gap-6 sm:px-5 sm:py-8">
        <DesktopAppNav />
        <main className="min-w-0">{children}</main>
      </div>

      {/* 移动端底部标签栏(桌面隐藏)*/}
      <MobileTabBar />
    </div>
  )
}
