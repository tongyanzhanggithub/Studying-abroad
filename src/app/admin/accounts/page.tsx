import Link from 'next/link'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { formatDate } from '@/lib/utils'
import { AccountRow, AddAccount, ROLE_LABEL } from './AccountEditor'

/**
 * 员工账号与角色。
 *
 * ⚠️ 学生不在这里。学生用手机号登录、走 User 表 —— 客户和员工是两套
 *    完全独立的身份体系。混在一起迟早会出现「某个学生被误设成运营」。
 */
export default async function AdminAccountsPage() {
  const me = await requireAdmin('super_admin')

  const [accounts, deliverers] = await Promise.all([
    db.adminUser.findMany({
      include: { deliverer: { select: { name: true } } },
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
    }),
    db.deliverer.findMany({
      where: { active: true },
      include: { account: { select: { id: true } } },
      orderBy: { name: 'asc' },
    }),
  ])

  const delivererOptions = deliverers.map((d) => ({
    id: d.id,
    name: d.name,
    role: d.role,
    taken: d.account !== null,
  }))

  const unlinked = deliverers.filter((d) => d.account === null)
  const now = new Date()

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">账号与角色</h1>
        <p className="mt-1 text-sm text-ink-600">
          共 {accounts.length} 个员工账号。学生账号不在这里 —— 他们用手机号登录,是另一套体系。
        </p>
      </div>

      <Card className="border-brand-200 bg-brand-50/50">
        <h2 className="text-sm font-medium text-ink-900">四种角色</h2>
        <dl className="mt-2 space-y-1.5 text-xs leading-relaxed text-ink-700">
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 font-medium">超级管理员</dt>
            <dd>全部权限,含价格、AI key、账号管理。这是权限体系的根,尽量少给。</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 font-medium">运营</dt>
            <dd>日常运营:派单、核对数据、处理异议、通知队列、线索。</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 font-medium">数据录入</dt>
            <dd>只能核对院校数据,看不到订单、线索和钱相关的页面。</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 font-medium">交付顾问</dt>
            <dd>
              <strong>不是运营的一级,是另一条轴。</strong>
              顾问登录后进 <code>/advisor</code>,只看派给自己的单,
              进不了运营后台的任何一页。必须关联一个交付人档案才有单可看。
            </dd>
          </div>
        </dl>
      </Card>

      {unlinked.length > 0 && (
        <Card className="border-dashed">
          <p className="text-sm leading-relaxed text-ink-700">
            有 <strong>{unlinked.length}</strong> 位交付人还没有登录账号(
            {unlinked.map((d) => d.name).join('、')})。
            他们能被派单,但看不到自己的单,只能靠运营在企微里转达。
            给他们建「交付顾问」账号即可。
          </p>
        </Card>
      )}

      <AddAccount deliverers={delivererOptions} />

      <div className="space-y-3">
        {accounts.map((a) => (
          <AccountRow
            key={a.id}
            a={{
              id: a.id,
              email: a.email,
              name: a.name,
              role: a.role,
              active: a.active,
              delivererId: a.delivererId,
              delivererName: a.deliverer?.name ?? null,
              lastLoginAt: a.lastLoginAt ? formatDate(a.lastLoginAt) : null,
              locked: a.lockedUntil !== null && a.lockedUntil > now,
            }}
            deliverers={delivererOptions}
            isSelf={a.id === me.adminId}
          />
        ))}
      </div>

      <Card className="bg-ink-50">
        <p className="text-xs leading-relaxed text-ink-600">
          没有交付人档案的话,先去{' '}
          <Link href="/admin/deliverers" className="underline">
            交付人
          </Link>{' '}
          建档,再回这里建账号并关联。
          档案负责「分成比例、联系方式、接单记录」,账号负责「能不能登录、看得到什么」——
          分开是因为有些交付人只是偶尔接单,没必要给登录权限。
          <br />
          <br />
          角色 {Object.values(ROLE_LABEL).join(' / ')} 的权限边界在代码里由{' '}
          <code>requireAdmin</code> / <code>requireAdvisor</code> 强制,不是靠导航栏藏链接 ——
          手打 URL 也进不去。
        </p>
      </Card>
    </div>
  )
}
