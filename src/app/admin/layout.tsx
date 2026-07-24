import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAdminSession } from '@/lib/auth/session'
import { logoutAdmin } from './login/actions'

/**
 * 后台导航按职能分组 —— 13 个入口平铺时找一个功能得逐个扫,
 * 分成「数据 / 服务 / 运营 / 系统」四组后,一眼定位到该去哪一块。
 */
const NAV_GROUPS = [
  {
    title: '数据',
    items: [
      { href: '/admin/regions', label: '地区开放' },
      { href: '/admin/programs', label: '院校库' },
      { href: '/admin/collect', label: 'AI 采集' },
    ],
  },
  {
    title: '服务',
    items: [
      { href: '/admin/services', label: '老师服务' },
      { href: '/admin/dispatch', label: '服务派单' },
      { href: '/admin/deliverers', label: '老师库' },
      { href: '/admin/settlement', label: '月结分成' },
    ],
  },
  {
    title: '运营',
    items: [
      { href: '/admin/pricing', label: '套餐定价' },
      { href: '/admin/leads', label: '线索' },
      { href: '/admin/notifications', label: '通知队列' },
      { href: '/admin/metrics', label: '数据看板' },
    ],
  },
  {
    title: '系统',
    items: [
      { href: '/admin/settings', label: 'AI 设置' },
      { href: '/admin/accounts', label: '账号' },
    ],
  },
]

const ROLE_LABEL: Record<string, string> = {
  super_admin: '超级管理员',
  operator: '运营管理员',
  data_entry: '数据核对',
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // 登录页本身不校验,否则会无限重定向
  const pathname = (await headers()).get('x-pathname') ?? ''
  const isLoginPage = pathname.endsWith('/admin/login')

  const session = await getAdminSession()
  if (!session && !isLoginPage) redirect('/admin/login')

  if (!session) return <>{children}</>

  /**
   * ⚠️ 顾问不进运营后台。
   *    这一层不能只靠导航里不放链接 —— 顾问手打 /admin/leads 照样能进。
   *    每个 admin 页面里的 requireAdmin 也会拦(advisor 排名 0),
   *    但那会抛 FORBIDDEN 变成错误页;在这里直接送去他该去的地方更合理。
   */
  if (session.role === 'advisor') redirect('/advisor')

  const activeItem = NAV_GROUPS.flatMap((g) => g.items).find(
    (n) => pathname === n.href || pathname.startsWith(n.href + '/'),
  )

  return (
    <div className="min-h-screen bg-[#f6f7fa] text-ink-800">
      <div className="mx-auto grid min-h-screen max-w-7xl lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="hidden border-r border-ink-100 bg-white/94 px-4 py-5 shadow-[18px_0_45px_rgba(15,23,42,0.03)] lg:block">
          <div className="sticky top-5">
            <Link href="/admin/programs" className="block rounded-xl bg-gradient-to-br from-brand-50 to-white px-3 py-3">
              <span className="block text-lg font-semibold text-ink-900">Compass 管理台</span>
              <span className="mt-1 block text-xs leading-relaxed text-ink-500">数据、老师服务与运营</span>
            </Link>

            <nav className="mt-7 space-y-6">
              {NAV_GROUPS.map((g) => (
                <div key={g.title}>
                  <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                    {g.title}
                  </p>
                  <div className="mt-2 space-y-1">
                    {g.items.map((n) => {
                      const active = pathname === n.href || pathname.startsWith(n.href + '/')
                      return (
                        <Link
                          key={n.href}
                          href={n.href}
                          className={`block rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                            active
                              ? 'border-brand-100 bg-brand-50 text-brand-700 shadow-[0_10px_24px_rgba(225,48,108,0.08)]'
                              : 'border-transparent text-ink-600 hover:border-ink-100 hover:bg-ink-50 hover:text-ink-900'
                          }`}
                        >
                          {n.label}
                        </Link>
                      )
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-30 border-b border-ink-100 bg-white/88 backdrop-blur-xl">
            <div className="flex min-h-14 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
              <div className="min-w-0">
                <Link href="/admin/programs" className="font-semibold text-ink-900 lg:hidden">
                  Compass 管理台
                </Link>
                <div className="hidden lg:block">
                  <p className="text-xs text-ink-400">管理员后台</p>
                  <p className="truncate text-sm font-medium text-ink-800">
                    {activeItem?.label ?? '工作台'}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
                  {ROLE_LABEL[session.role] ?? session.role}
                </span>
                <form action={logoutAdmin}>
                  <button className="text-sm text-ink-500 hover:text-ink-900">退出</button>
                </form>
              </div>
            </div>
            <nav className="flex gap-2 overflow-x-auto px-4 pb-3 text-sm lg:hidden">
              {NAV_GROUPS.flatMap((g) => g.items).map((n) => {
                const active = pathname === n.href || pathname.startsWith(n.href + '/')
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`shrink-0 rounded-full border px-3 py-1.5 ${
                      active
                        ? 'border-brand-500 bg-brand-600 text-white'
                        : 'border-ink-200 bg-white text-ink-600'
                    }`}
                  >
                    {n.label}
                  </Link>
                )
              })}
            </nav>
          </header>

          <main className="px-4 py-5 sm:px-6 lg:px-8 lg:py-8">{children}</main>
        </div>
      </div>
    </div>
  )
}
