import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { formatCents, formatDate } from '@/lib/utils'
import { previewSettlement, toSettlementMonth } from '@/lib/services/settlement'
import { SettleButton } from './SettleButton'

/**
 * 交付人月结分成(PRD 4.6)。
 *
 * 口径:该月内**已确认**且**尚未结算**的订单。
 * 用确认时间而非下单时间划分 —— 钱在服务真正交付完成后才算数。
 *
 * ⚠️ 本页只算账、留痕,**不发起真实付款**。
 *    MVP 阶段由财务按这张表人工转账。
 */
export default async function AdminSettlementPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  await requireAdmin('super_admin')
  const sp = await searchParams

  // 默认结上个月的账 —— 当月还没过完,结了也不完整
  const now = new Date()
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const month = sp.month ?? toSettlementMonth(lastMonth)

  const [rows, disputed, settled] = await Promise.all([
    previewSettlement(month),
    db.serviceOrder.findMany({
      where: { status: 'disputed' },
      include: { sku: true, user: true, deliverer: true },
      orderBy: { disputedAt: 'asc' },
    }),
    db.serviceOrder.findMany({
      where: { settlementMonth: month },
      select: { payoutCents: true },
    }),
  ])

  const totalPayout = rows.reduce((s, r) => s + r.payoutCents, 0)
  const totalGross = rows.reduce((s, r) => s + r.grossCents, 0)
  const alreadySettled = settled.reduce((s, o) => s + (o.payoutCents ?? 0), 0)

  // 最近 6 个月供切换
  const monthOptions = Array.from({ length: 6 }, (_, i) =>
    toSettlementMonth(new Date(now.getFullYear(), now.getMonth() - i, 1)),
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-ink-900">月结分成</h1>
        <form action="/admin/settlement" className="flex gap-2">
          <select
            name="month"
            defaultValue={month}
            className="rounded-lg border border-ink-200 px-3 py-2 text-sm"
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white">
            查看
          </button>
        </form>
      </div>

      {/* 异议订单必须先处理 —— 放在最前面,不能被忽略 */}
      {disputed.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <h2 className="font-medium text-amber-900">
            {disputed.length} 笔订单有未处理的异议
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-amber-900">
            这些订单不会被自动确认,也不会进入结算。请先联系学生与交付人处理,
            确认后才会计入下个结算批次。
          </p>
          <div className="mt-3 space-y-2">
            {disputed.map((o) => (
              <div key={o.id} className="rounded-lg bg-white px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 text-ink-900">
                  <span className="font-medium">{o.sku.name}</span>
                  <span className="text-xs text-ink-500">{o.user.phone}</span>
                  <span className="text-xs text-ink-500">
                    交付人 {o.deliverer?.name ?? '未派单'}
                  </span>
                  <span className="text-xs text-ink-400">
                    {o.disputedAt ? formatDate(o.disputedAt) : ''}
                  </span>
                </div>
                {o.disputeReason && (
                  <p className="mt-1 text-xs leading-relaxed text-ink-600">
                    {o.disputeReason}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <p className="text-xs text-ink-400">待结算订单</p>
          <p className="mt-1 text-2xl font-semibold text-ink-900">
            {rows.reduce((s, r) => s + r.orderCount, 0)}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-ink-400">服务流水</p>
          <p className="mt-1 text-2xl font-semibold text-ink-900">{formatCents(totalGross)}</p>
        </Card>
        <Card>
          <p className="text-xs text-ink-400">应付交付人</p>
          <p className="mt-1 text-2xl font-semibold text-ink-900">{formatCents(totalPayout)}</p>
        </Card>
        <Card>
          <p className="text-xs text-ink-400">平台留存</p>
          <p className="mt-1 text-2xl font-semibold text-ink-900">
            {formatCents(totalGross - totalPayout)}
          </p>
        </Card>
      </div>

      {alreadySettled > 0 && (
        <Card>
          <p className="text-sm text-ink-600">
            {month} 已结算 {formatCents(alreadySettled)}。
            下方列出的是该月<strong>尚未结算</strong>的部分。
          </p>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-600">
            {month} 没有待结算的订单。
            <br />
            <span className="text-xs text-ink-400">
              只有「已确认」状态的订单才会进入结算 —— 已交付但学生还没验收的不算。
            </span>
          </p>
        </Card>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-200 text-left text-xs text-ink-400">
                <tr>
                  <th className="px-4 py-2">交付人</th>
                  <th className="px-4 py-2">角色</th>
                  <th className="px-4 py-2">联系方式</th>
                  <th className="px-4 py-2 text-right">单数</th>
                  <th className="px-4 py-2 text-right">流水</th>
                  <th className="px-4 py-2 text-right">分成比例</th>
                  <th className="px-4 py-2 text-right">应付</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.delivererId} className="border-b border-ink-100 last:border-0">
                    <td className="px-4 py-2 font-medium text-ink-900">{r.delivererName}</td>
                    <td className="px-4 py-2 text-xs text-ink-600">{r.role}</td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-600">
                      {r.wxContact ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-right">{r.orderCount}</td>
                    <td className="px-4 py-2 text-right">{formatCents(r.grossCents)}</td>
                    <td className="px-4 py-2 text-right text-xs text-ink-600">
                      {Math.round(r.splitRatio * 100)}%
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-ink-900">
                      {formatCents(r.payoutCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SettleButton month={month} orderCount={rows.reduce((s, r) => s + r.orderCount, 0)} />
        </>
      )}

      <Card className="bg-ink-50">
        <p className="text-xs leading-relaxed text-ink-600">
          点「确认结算」只会给订单打上结算批次并锁定应付金额,<strong>不会发起任何付款</strong>。
          实际转账由财务按此表线下执行。锁定金额是为了防止日后调整分成比例时改动历史账目。
        </p>
      </Card>
    </div>
  )
}
