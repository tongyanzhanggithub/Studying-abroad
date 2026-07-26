import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { formatCents, formatDate } from '@/lib/utils'
import { InvoiceActions } from './InvoiceActions'

/**
 * 开票申请队列。
 *
 * 定价页承诺「发票可在订单页申请开具」,此前这个承诺没有任何兑现机制 ——
 * 用户提不了、运营也看不到谁要过。这一页是队列出口。
 *
 * 系统不对接开票平台:财务在自己的开票系统里开完,回这里回填发票号。
 */
export default async function AdminInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  await requireAdmin('operator')
  const { tab = 'pending' } = await searchParams

  const [rows, pendingCount, doneCount] = await Promise.all([
    db.invoiceRequest.findMany({
      where: tab === 'done' ? { status: { in: ['issued', 'rejected'] } } : { status: 'pending' },
      include: { user: { select: { phone: true } }, payment: true },
      orderBy: { createdAt: tab === 'done' ? 'desc' : 'asc' },
      take: 200,
    }),
    db.invoiceRequest.count({ where: { status: 'pending' } }),
    db.invoiceRequest.count({ where: { status: { in: ['issued', 'rejected'] } } }),
  ])

  const TABS = [
    { key: 'pending', label: `待开具 ${pendingCount}` },
    { key: 'done', label: `已处理 ${doneCount}` },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">开票申请</h1>
        <p className="mt-1 text-sm text-ink-600">
          在开票系统里开完票后,回这里回填发票号码 —— 用户在订单页能看到状态。
        </p>
      </div>

      <div className="flex gap-2">
        {TABS.map((t) => (
          <a
            key={t.key}
            href={`/admin/invoices?tab=${t.key}`}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              tab === t.key
                ? 'border-brand-500 bg-brand-600 text-white'
                : 'border-ink-200 bg-white text-ink-600'
            }`}
          >
            {t.label}
          </a>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-600">
            {tab === 'done' ? '还没有处理过的开票申请。' : '没有待开具的发票。'}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink-900">{r.title}</span>
                    <span className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600">
                      {r.titleType === 'company' ? '企业' : '个人'}
                    </span>
                    <span className="font-semibold text-ink-900">
                      {formatCents(r.payment.amountCents)}
                    </span>
                    {r.status !== 'pending' && (
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          r.status === 'issued'
                            ? 'bg-green-50 text-green-800'
                            : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {r.status === 'issued' ? '已开具' : '未能开具'}
                      </span>
                    )}
                  </div>
                  {r.taxNumber && (
                    <p className="mt-1 font-mono text-xs text-ink-600">税号 {r.taxNumber}</p>
                  )}
                  <p className="mt-1 text-xs text-ink-600">
                    邮箱 {r.email} · 手机号 {r.user.phone}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-400">
                    申请于 {formatDate(r.createdAt)} · 订单号{' '}
                    <span className="font-mono">{r.payment.outTradeNo}</span>
                  </p>
                  {r.note && <p className="mt-1 text-xs text-ink-600">备注:{r.note}</p>}
                  {r.resultNote && (
                    <p className="mt-1 rounded bg-ink-50 px-2 py-1 text-xs text-ink-700">
                      {r.status === 'issued' ? '发票号码:' : '未开具原因:'}
                      {r.resultNote}
                    </p>
                  )}
                </div>

                {r.status === 'pending' && (
                  <div className="w-full shrink-0 sm:w-72">
                    <InvoiceActions id={r.id} />
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
