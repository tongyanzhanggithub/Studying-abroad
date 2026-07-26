import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { formatDate, formatCents } from '@/lib/utils'
import { ORDER_STATUS_LABEL } from '@/lib/services/dispatch'
import { UserActions } from './UserActions'

/**
 * 用户 / 会员管理。
 *
 * 客服日常入口:按手机号查人 → 看季票、订单、材料、AI 用量 → 延期 / 补发 / 重置配额。
 * 此前这些全部只能连数据库手改。
 *
 * ⚠️ 刻意**不做全量列表**:用户表会持续增长,列全部既慢又没有意义
 *    (运营的真实动作永远是「某个来找客服的人」)。必须先搜手机号。
 *    顺带也降低了「随手翻看所有用户个人信息」的可能。
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const admin = await requireAdmin('operator')
  const { q } = await searchParams
  const query = (q ?? '').trim()

  const user = query
    ? await db.user.findFirst({
        where: {
          OR: [
            { phone: { contains: query } },
            { name: { contains: query, mode: 'insensitive' } },
          ],
        },
        include: {
          profile: true,
          subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' } },
          serviceOrders: { include: { sku: true }, orderBy: { createdAt: 'desc' }, take: 20 },
          _count: { select: { schoolChoices: true, materials: true, essays: true } },
        },
      })
    : null

  const now = new Date()
  const activeSub = user?.subscriptions.find(
    (s) => s.status === 'active' && (!s.expiresAt || s.expiresAt > now),
  )

  const todayUsage = user
    ? await db.aiUsageDaily.findUnique({
        where: { userId_day: { userId: user.id, day: now.toISOString().slice(0, 10) } },
      })
    : null

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">用户</h1>
        <p className="mt-1 text-sm text-ink-600">
          按手机号或姓名查找。查到之后可以看季票、订单与用量,并做延期 / 补发。
        </p>
      </div>

      <Card>
        <form method="get" className="flex flex-wrap gap-2">
          <input
            name="q"
            defaultValue={query}
            placeholder="手机号(可只输后几位)或姓名"
            className="min-h-11 flex-1 rounded-lg border border-ink-200 px-3 text-sm"
            aria-label="搜索用户"
          />
          <button className="min-h-11 rounded-lg bg-brand-600 px-5 text-sm font-medium text-white hover:bg-brand-700">
            查找
          </button>
        </form>
      </Card>

      {query && !user && (
        <Card>
          <p className="text-sm text-ink-600">
            没找到匹配「{query}」的用户。手机号请确认输入正确;学生只有走过登录流程才会有账号
            (只做过免费评估的人在<a href="/admin/leads" className="text-brand-600 hover:underline">线索</a>里)。
          </p>
        </Card>
      )}

      {user && (
        <>
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-lg font-medium text-ink-900">
                  {user.name || '(未填姓名)'}
                  <span className="ml-2 font-mono text-sm text-ink-600">{user.phone}</span>
                </p>
                <p className="mt-1 text-xs text-ink-400">
                  注册于 {formatDate(user.createdAt)}
                  {user.agreedTermsAt && ` · 已同意协议 ${user.agreedTermsVersion ?? ''}`}
                </p>
                {user.deletionRequestedAt && (
                  <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                    该用户已申请注销({formatDate(user.deletionRequestedAt)})
                  </p>
                )}
              </div>
              <div className="text-right text-xs text-ink-500">
                <p>选校 {user._count.schoolChoices} · 材料 {user._count.materials} · 文书 {user._count.essays}</p>
                <p className="mt-1">
                  今日 AI 用量 {todayUsage?.count ?? 0} 次
                </p>
              </div>
            </div>
          </Card>

          {/* 季票 */}
          <Card>
            <h2 className="text-sm font-medium text-ink-900">季票</h2>
            {user.subscriptions.length === 0 ? (
              <p className="mt-2 text-sm text-ink-500">没有任何订阅记录 —— 这是个免费用户。</p>
            ) : (
              <div className="mt-3 space-y-2">
                {user.subscriptions.map((s) => {
                  const isActive = s.id === activeSub?.id
                  return (
                    <div
                      key={s.id}
                      className={`rounded-lg border px-3 py-2.5 text-sm ${
                        isActive ? 'border-brand-200 bg-brand-50' : 'border-ink-100'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-ink-900">
                          {s.plan.name}
                          <span className="ml-2 text-xs font-normal text-ink-500">
                            {isActive ? '生效中' : s.status === 'refunded' ? '已退款' : '已失效'}
                          </span>
                        </span>
                        <span className="text-xs text-ink-500">
                          {s.paidAt ? `付款 ${formatDate(s.paidAt)}` : '未付款'}
                          {s.expiresAt && ` · 到期 ${formatDate(s.expiresAt)}`}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          {/* 服务订单 */}
          <Card>
            <h2 className="text-sm font-medium text-ink-900">服务订单</h2>
            {user.serviceOrders.length === 0 ? (
              <p className="mt-2 text-sm text-ink-500">没有加购过人工服务。</p>
            ) : (
              <div className="mt-3 space-y-2">
                {user.serviceOrders.map((o) => (
                  <div
                    key={o.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-100 px-3 py-2.5 text-sm"
                  >
                    <span className="text-ink-900">{o.sku.name}</span>
                    <span className="text-xs text-ink-500">
                      {formatCents(o.amountCents)} · {ORDER_STATUS_LABEL[o.status]} ·{' '}
                      {formatDate(o.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <UserActions
            userId={user.id}
            activeSubscriptionId={activeSub?.id ?? null}
            canExtend={admin.role === 'super_admin'}
          />
        </>
      )}
    </div>
  )
}
