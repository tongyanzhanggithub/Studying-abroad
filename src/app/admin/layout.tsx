import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAdminSession } from '@/lib/auth/session'

/**
 * 后台导航按职能分组 —— 13 个入口平铺时找一个功能得逐个扫,
 * 分成「数据 / 服务 / 运营 / 系统」四组后,一眼定位到该去哪一块。
 */
const NAV_GROUPS = [
  {
    title: '数据',
    items: [
      { href: '/admin/regions', label: '地区开放' },
      { href: '/admin/programs', label: '院校库 / 待核对' },
      { href: '/admin/collect', label: 'AI 采集' },
    ],
  },
  {
    title: '服务',
    items: [
      { href: '/admin/services', label: '人工服务' },
      { href: '/admin/dispatch', label: '服务派单' },
      { href: '/admin/deliverers', label: '交付人' },
      { href: '/admin/settlement', label: '月结分成' },
    ],
  },
  {
    title: '运营',
    items: [
      { href: '/admin/pricing', label: '季票价格' },
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

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
          <Link href="/admin" className="font-semibold text-ink-900">
            Compass 后台
          </Link>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            {NAV_GROUPS.map((g) => (
              <div key={g.title} className="flex items-center gap-2">
                <span className="text-xs font-medium text-ink-300">{g.title}</span>
                {g.items.map((n) => (
                  <Link key={n.href} href={n.href} className="text-ink-600 hover:text-ink-900">
                    {n.label}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
          <span className="ml-auto text-xs text-ink-400">{session.role}</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
    </div>
  )
}
