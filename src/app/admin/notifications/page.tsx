import Link from 'next/link'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { formatDate } from '@/lib/utils'
import { QueueTable, type QueueRow } from './QueueTable'

/**
 * 待发送通知队列。
 *
 * ⚠️ 这一页以前不存在,但 src/lib/notifications/send.ts 的注释里写着
 *    「渠道未接入时写入 pending,运营可在后台看到『待发送』队列并人工兜底」——
 *    承诺了但没做。结果是:微信/短信渠道都没接,每一条通知都停在 pending,
 *    而**没有任何人看得到**。截止日期提醒是 PRD 里的强制项,
 *    积压在这里等于有用户会错过申请截止。
 *
 * 在渠道接通之前,这一页就是唯一的兜底出口。
 */
const PAGE_SIZE = 100

export default async function AdminNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  await requireAdmin('operator')
  const { tab = 'pending' } = await searchParams

  const isPending = tab === 'pending'

  const [rows, pendingCount, sentCount, deadlinePending] = await Promise.all([
    db.notification.findMany({
      where: { status: isPending ? 'pending' : { not: 'pending' } },
      include: { user: { select: { phone: true } }, template: { select: { code: true } } },
      // 截止提醒最急,排最前;同类里最早的先处理
      orderBy: [{ createdAt: 'asc' }],
      take: PAGE_SIZE,
    }),
    db.notification.count({ where: { status: 'pending' } }),
    db.notification.count({ where: { status: { not: 'pending' } } }),
    db.notification.count({
      where: { status: 'pending', template: { code: { startsWith: 'deadline_' } } },
    }),
  ])

  const list: QueueRow[] = rows
    .map((n) => {
      const payload = (n.payload ?? {}) as { title?: string; body?: string }
      return {
        id: n.id,
        phone: n.user.phone,
        templateCode: n.template.code,
        channel: n.channel,
        title: payload.title ?? n.template.code,
        body: payload.body ?? '',
        createdAt: formatDate(n.createdAt),
        isDeadline: n.template.code.startsWith('deadline_'),
      }
    })
    // 截止提醒置顶 —— 它是唯一一类「晚了就没有意义」的通知
    .sort((a, b) => Number(b.isDeadline) - Number(a.isDeadline))

  const TABS = [
    { key: 'pending', label: `待发送 ${pendingCount}` },
    { key: 'done', label: `已处理 ${sentCount}` },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">通知队列</h1>
        <p className="mt-1 text-sm leading-relaxed text-ink-600">
          微信订阅消息 / 短信 / 邮件渠道都还没接入,所有通知会停在这里等人工处理。
        </p>
      </div>

      {pendingCount > 0 && (
        <Card className="border-red-200 bg-red-50">
          <p className="text-sm leading-relaxed text-red-900">
            <strong>{pendingCount}</strong> 条通知没有送达用户
            {deadlinePending > 0 && (
              <>
                ,其中 <strong>{deadlinePending}</strong> 条是<strong>截止日期提醒</strong>
              </>
            )}
            。渠道接通之前,这些必须靠人工打电话或微信补上 ——
            按 PRD 11.3,截止提醒漏发要立即人工电话兜底。
          </p>
        </Card>
      )}

      <Card className="bg-ink-50">
        <p className="text-xs leading-relaxed text-ink-600">
          <strong>要根治得接渠道:</strong>微信小程序订阅消息需要小程序资质与教育类目,
          阿里云短信需要营业执照。两条都在你的公司注册 / 备案那条串行路径上。
          接通之后 <code>src/lib/notifications/send.ts</code> 里的 <code>deliver()</code>{' '}
          换成真实调用,这一页就只剩下查历史的作用了。
        </p>
      </Card>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/notifications?tab=${t.key}`}
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

      {list.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-600">
            {isPending ? '队列是空的,没有积压。' : '还没有处理过的通知。'}
          </p>
        </Card>
      ) : isPending ? (
        <QueueTable rows={list} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
          {rows.map((n, i) => {
            const payload = (n.payload ?? {}) as { title?: string; body?: string }
            return (
              <div
                key={n.id}
                className={`flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3 text-sm ${
                  i > 0 ? 'border-t border-ink-100' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-ink-900">{n.user.phone}</span>
                  <p className="text-xs text-ink-600">{payload.title}</p>
                  {n.error && <p className="text-xs text-ink-400">{n.error}</p>}
                </div>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                    n.status === 'sent' ? 'bg-green-50 text-green-800' : 'bg-ink-100 text-ink-600'
                  }`}
                >
                  {n.status === 'sent' ? '已通知' : '已作废'}
                </span>
                <span className="shrink-0 text-xs text-ink-400">
                  {formatDate(n.sentAt ?? n.createdAt)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
