import Link from 'next/link'
import { requireUser } from '@/lib/auth/session'
import { listInbox } from '@/lib/notifications/inbox'
import { Card } from '@/components/ui'
import { formatDate } from '@/lib/utils'
import { MarkAllRead } from './MarkAllRead'

/**
 * 站内消息中心。
 *
 * 通知已经在库里躺着(截止提醒、数据变更、服务交付),但投递渠道依赖企业资质,
 * 资质到位前一条都发不出去。这一页把它们变成用户看得见的东西 ——
 * 不依赖任何外部资质,是当前唯一能兑现「关键节点有人提醒你」这个承诺的方式。
 */
export default async function NotificationsPage() {
  const user = await requireUser()
  const items = await listInbox(user.id)
  const unread = items.filter((i) => !i.read).length

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">消息</h1>
          <p className="mt-1 text-sm text-ink-500">
            截止日提醒、选校数据变更、服务交付通知都会出现在这里。
          </p>
        </div>
        {unread > 0 && <MarkAllRead count={unread} />}
      </div>

      {items.length === 0 ? (
        <Card>
          <p className="text-sm leading-relaxed text-ink-600">
            还没有任何消息。
            <br />
            选好学校之后,系统会在每个项目截止前 14 / 7 / 3 / 1 天提醒你,
            申请要求或截止日期有变动时也会在这里通知。
          </p>
          <Link
            href="/app/schools"
            className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
          >
            去选校 →
          </Link>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Card key={item.id}>
              <div className="flex items-start gap-3">
                {/* 未读圆点 —— 不用红色,消息本身可能是坏消息,红点会叠加焦虑 */}
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    item.read ? 'bg-ink-200' : 'bg-brand-500'
                  }`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p
                      className={`text-sm ${
                        item.read ? 'text-ink-700' : 'font-medium text-ink-900'
                      }`}
                    >
                      {item.title}
                      {!item.read && <span className="sr-only">(未读)</span>}
                    </p>
                    <time className="shrink-0 text-xs text-ink-400">
                      {formatDate(item.createdAt)}
                    </time>
                  </div>
                  {item.body && (
                    <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink-600">
                      {item.body}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/*
        诚实说明:渠道未接通期间,消息只在站内可见。
        不写这句话的话,用户会以为「没收到短信 = 没有提醒」,
        从而不来看这一页 —— 那这一页就白做了。
      */}
      <p className="text-xs leading-relaxed text-ink-400">
        目前提醒只在站内显示。微信 / 短信推送正在接入中,接通后重要提醒会同时发到你手机上。
        建议临近截止时常回来看看。
      </p>
    </div>
  )
}
