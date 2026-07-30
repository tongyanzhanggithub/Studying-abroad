import Link from 'next/link'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { formatCents, formatDate } from '@/lib/utils'
import { ORDER_STATUS_LABEL } from '@/lib/services/dispatch'
import { AssignPanel } from './AssignPanel'
import { StuckRefundPanel } from './StuckRefundPanel'
import type { OrderStatus } from '@prisma/client'

/**
 * 服务派单看板(PRD 4.6 / 4.10)。
 * MVP 简化:顾问端不开发独立系统,后台派单 + 企业微信群交付。
 */
// 不用 as const —— Prisma 的 `in` 要可变数组,readonly 元组过不了类型检查
const OPEN_STATUSES: OrderStatus[] = ['paid', 'assigned', 'delivering', 'delivered', 'disputed']
const CLOSED_STATUSES: OrderStatus[] = ['confirmed', 'refunded', 'cancelled']
/**
 * ⚠️ 异常单:`refunding` 与 `pending_payment` 此前**两个 tab 都不在**,
 *    在后台完全不可见。后果是退款中途失败(渠道调用中断)的订单会永久失联 ——
 *    钱没退、状态卡死、运营看不到,只能连数据库查。
 *    单开一个 tab 让它们浮出来,并给出可推进的操作。
 */
const STUCK_STATUSES: OrderStatus[] = ['refunding', 'pending_payment']

export default async function AdminDispatchPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  await requireAdmin('operator')
  const { tab = 'open' } = await searchParams

  const statusesForTab =
    tab === 'history' ? CLOSED_STATUSES : tab === 'stuck' ? STUCK_STATUSES : OPEN_STATUSES
  const where = { status: { in: statusesForTab } }

  const [orders, deliverers, openCount, historyCount, stuckCount] = await Promise.all([
    db.serviceOrder.findMany({
      where,
      include: { sku: true, user: true, deliverer: true },
      orderBy: tab === 'history' ? { updatedAt: 'desc' } : { paidAt: 'asc' },
      take: 200,
    }),
    db.deliverer.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    db.serviceOrder.count({ where: { status: { in: OPEN_STATUSES } } }),
    db.serviceOrder.count({ where: { status: { in: CLOSED_STATUSES } } }),
    db.serviceOrder.count({ where: { status: { in: STUCK_STATUSES } } }),
  ])

  const now = Date.now()
  const disputed = orders.filter((o) => o.status === 'disputed').length
  const unassigned = orders.filter((o) => o.status === 'paid').length

  const TABS = [
    { key: 'open', label: `待处理 ${openCount}` },
    // 异常单为 0 时也保留入口 —— 隐藏的话运营永远不知道该来这里看
    { key: 'stuck', label: `异常 ${stuckCount}` },
    { key: 'history', label: `已结束 ${historyCount}` },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">服务派单</h1>
          <p className="mt-1 text-sm text-ink-600">
            {tab === 'history'
              ? '已完成 / 已退款 / 已取消的订单。'
              : tab === 'stuck'
                ? '卡在退款中或待付款的订单。退款中的说明渠道调用没走完 —— 钱可能还没退到用户账上,需要人工核对后完成或退回。'
                : `${unassigned} 单待派,${disputed} 单有异议。超过 SLA 的会标红。`}
          </p>
        </div>
        <Link
          href="/admin/deliverers"
          className="text-sm text-brand-600 hover:underline"
        >
          管理交付人 →
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/dispatch?tab=${t.key}`}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              tab === t.key
                ? 'border-brand-500 bg-brand-50 text-brand-700'
                : 'border-ink-200 bg-white text-ink-600'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {deliverers.length === 0 && tab !== 'history' && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm leading-relaxed text-amber-900">
            还没有在岗的交付人,订单派不出去。去{' '}
            <Link href="/admin/deliverers" className="underline">
              交付人
            </Link>{' '}
            录入至少一位。
          </p>
        </Card>
      )}

      {orders.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-600">
            {tab === 'history' ? '还没有结束的订单。' : '没有待处理订单。'}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const deadline = o.paidAt ? o.paidAt.getTime() + o.sku.slaHours * 3600_000 : null
            const overdue = deadline !== null && now > deadline && !o.deliveredAt
            const isDisputed = o.status === 'disputed'

            return (
              <Card
                key={o.id}
                className={
                  isDisputed ? 'border-amber-300' : overdue ? 'border-red-200' : undefined
                }
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink-900">{o.sku.name}</span>
                      <span className="text-xs text-ink-400">{formatCents(o.amountCents)}</span>
                      <span className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600">
                        {ORDER_STATUS_LABEL[o.status]}
                      </span>
                      {isDisputed && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                          需处理
                        </span>
                      )}
                      {overdue && !isDisputed && (
                        <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">
                          已超 SLA
                        </span>
                      )}
                    </div>

                    <p className="mt-0.5 text-sm text-ink-600">
                      {/* 账号注销后 user 解绑为 null(见 schema 的 Payment/ServiceOrder 注释)——
                          明确写出来,免得运营看到空白以为是数据坏了 */}
                      用户 {o.user?.phone ?? '账号已注销'} · 付款{' '}
                      {o.paidAt ? formatDate(o.paidAt) : '—'}
                    </p>
                    <p className="text-xs text-ink-400">
                      {o.deliverer
                        ? `交付人 ${o.deliverer.name}${
                            o.splitRatio ? ` · 分成 ${Math.round(o.splitRatio * 100)}%` : ''
                          }`
                        : '未派单'}
                      {deadline ? ` · SLA 至 ${formatDate(new Date(deadline))}` : ''}
                      {o.settlementMonth ? ` · 已结算 ${o.settlementMonth}` : ''}
                    </p>

                    {o.assignNote && (
                      <p className="mt-1.5 text-xs text-ink-500">派单说明:{o.assignNote}</p>
                    )}

                    {o.deliveryNote && (
                      <div className="mt-1.5 rounded bg-ink-50 px-2 py-1.5 text-xs leading-relaxed text-ink-700">
                        交付记录:{o.deliveryNote}
                        {o.deliveryUrl && (
                          <>
                            {' · '}
                            <a
                              href={o.deliveryUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="break-all text-brand-600 hover:underline"
                            >
                              交付物
                            </a>
                          </>
                        )}
                      </div>
                    )}

                    {o.disputeReason && (
                      <p className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-xs leading-relaxed text-amber-900">
                        学生反馈:{o.disputeReason}
                      </p>
                    )}
                    {o.disputeResolution && (
                      <p className="mt-1 rounded bg-green-50 px-2 py-1 text-xs leading-relaxed text-green-900">
                        处理结论:{o.disputeResolution}
                        {o.disputeResolvedAt && `(${formatDate(o.disputeResolvedAt)})`}
                      </p>
                    )}
                  </div>

                  {o.status === 'refunding' ? (
                    <StuckRefundPanel orderId={o.id} />
                  ) : tab !== 'history' && tab !== 'stuck' ? (
                    <AssignPanel
                      orderId={o.id}
                      status={o.status}
                      currentDelivererId={o.delivererId}
                      deliverers={deliverers.map((d) => ({
                        id: d.id,
                        name: d.name,
                        role: d.role,
                      }))}
                    />
                  ) : null}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
