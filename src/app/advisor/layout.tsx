import { redirect } from 'next/navigation'
import { getAdminSession } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { logoutAdmin } from '@/app/admin/login/actions'
import { BrandLogo } from '@/components/BrandLogo'

/**
 * 顾问工作台外壳。
 *
 * 顾问是外部签约的交付人,不是员工 —— 他只应该看到派给自己的单,
 * 以及交付这些单必需的学生信息。院校库、价格、线索、别人的订单一律不可见。
 */
export default async function AdvisorLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession()
  if (!session) redirect('/admin/login')
  if (session.role !== 'advisor' && session.role !== 'super_admin') redirect('/admin')

  const deliverer = session.delivererId
    ? await db.deliverer.findUnique({ where: { id: session.delivererId } })
    : null

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <BrandLogo href="/advisor" />
            <span className="text-sm text-ink-500">顾问工作台</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-xs text-ink-400">
              {deliverer ? `${deliverer.name} · ${deliverer.role}` : session.role}
            </span>
            <form action={logoutAdmin}>
              <button className="text-ink-600 hover:text-ink-900">退出</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-8">{children}</main>
    </div>
  )
}
