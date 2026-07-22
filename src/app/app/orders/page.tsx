import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { formatCents, formatDate } from '@/lib/utils'
import { calcServiceRefund, calcSubscriptionRefund } from '@/lib/payment'
import { RefundButton } from './RefundButton'
import { DeliveryActions } from './DeliveryActions'
import { AUTO_CONFIRM_HOURS } from '@/lib/services/settlement'

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending_payment: '待支付',
  paid: '已支付,待派单',
  assigned: '已派单',
  delivering: '交付中',
  delivered: '已交付,待验收',
  disputed: '已提出异议,处理中',
  confirmed: '已完成',
  cancelled: '已取消',
  refunding: '退款中',
  refunded: '已退款',
}

export default async function OrdersPage() {
  const user = await requireUser()

  const [subscriptions, serviceOrders] = await Promise.all([
    db.subscription.findMany({
      where: { userId: user.id },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    }),
    db.serviceOrder.findMany({
      where: { userId: user.id },
      include: { sku: true, deliverer: true },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-ink-900">我的订单</h1>

      <section>
        <h2 className="mb-3 font-semibold text-ink-900">系统季票</h2>
        {subscriptions.length === 0 ? (
          <Card><p className="text-sm text-ink-600">还没有购买记录。</p></Card>
        ) : (
          <div className="space-y-2">
            {subscriptions.map((s) => {
              const refund =
                s.status === 'active' && s.paidAt
                  ? calcSubscriptionRefund({
                      amountCents: s.plan.priceCents,
                      paidAt: s.paidAt,
                      expiresAt: s.expiresAt,
                      coreModuleUseCount: s.coreModuleUseCount,
                    })
                  : null
              return (
                <Card key={s.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-ink-900">{s.plan.name}</p>
                      <p className="mt-0.5 text-sm text-ink-600">
                        {formatCents(s.plan.priceCents)} ·{' '}
                        {s.status === 'active' ? '生效中' : s.status === 'refunded' ? '已退款' : '未生效'}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-400">
                        {s.paidAt ? `购买于 ${formatDate(s.paidAt)}` : '未支付'}
                        {s.expiresAt ? ` · 有效期至 ${formatDate(s.expiresAt)}` : ''}
                      </p>
                    </div>
                    {refund && (
                      <div className="text-right">
                        {refund.allowed ? (
                          <RefundButton
                            kind="subscription"
                            id={s.id}
                            refundableCents={refund.refundableCents}
                            reason={refund.reason}
                          />
                        ) : (
                          <p className="max-w-48 text-xs text-ink-400">{refund.reason}</p>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-semibold text-ink-900">人工服务</h2>
        {serviceOrders.length === 0 ? (
          <Card><p className="text-sm text-ink-600">还没有购买记录。</p></Card>
        ) : (
          <div className="space-y-2">
            {serviceOrders.map((o) => {
              const refund = ['paid', 'assigned', 'delivering'].includes(o.status)
                ? calcServiceRefund({
                    amountCents: o.amountCents,
                    assignedAt: o.assignedAt,
                    deliveredAt: o.deliveredAt,
                  })
                : null
              return (
                <Card key={o.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-ink-900">{o.sku.name}</p>
                      <p className="mt-0.5 text-sm text-ink-600">
                        {formatCents(o.amountCents)} · {ORDER_STATUS_LABEL[o.status] ?? o.status}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-400">
                        {o.paidAt ? `下单于 ${formatDate(o.paidAt)}` : ''}
                        {o.deliverer ? ` · 交付人 ${o.deliverer.name}` : ''}
                      </p>
                      {/* 交付内容要摆在学生面前 —— 只写一句「已交付」而不说
                          交付了什么,学生没法判断该确认还是该提异议 */}
                      {o.deliveryNote && (
                        <div className="mt-1.5 max-w-md rounded bg-ink-50 px-2 py-1.5 text-xs leading-relaxed text-ink-700">
                          交付内容:{o.deliveryNote}
                          {o.deliveryUrl && (
                            <>
                              {' · '}
                              <a
                                href={o.deliveryUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="break-all text-brand-600 hover:underline"
                              >
                                打开交付物
                              </a>
                            </>
                          )}
                        </div>
                      )}
                      {o.status === 'disputed' && o.disputeReason && (
                        <p className="mt-1 max-w-md rounded bg-amber-50 px-2 py-1 text-xs leading-relaxed text-amber-900">
                          你的异议:{o.disputeReason}
                        </p>
                      )}
                      {o.disputeResolution && (
                        <p className="mt-1 max-w-md rounded bg-green-50 px-2 py-1 text-xs leading-relaxed text-green-900">
                          我们的处理:{o.disputeResolution}
                        </p>
                      )}
                    </div>

                    {/* 已交付 → 验收 / 提异议(PRD 5.3) */}
                    {o.status === 'delivered' ? (
                      <DeliveryActions
                        orderId={o.id}
                        hoursLeft={
                          o.deliveredAt
                            ? Math.max(
                                0,
                                Math.ceil(
                                  AUTO_CONFIRM_HOURS -
                                    (Date.now() - o.deliveredAt.getTime()) / 3600_000,
                                ),
                              )
                            : null
                        }
                      />
                    ) : (
                      refund &&
                      refund.allowed && (
                        <RefundButton
                          kind="service"
                          id={o.id}
                          refundableCents={refund.refundableCents}
                          reason={refund.reason}
                        />
                      )
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
