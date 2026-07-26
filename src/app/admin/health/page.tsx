import Link from 'next/link'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { env } from '@/lib/env'
import { Card } from '@/components/ui'
import { getCronStatuses } from '@/lib/cron-heartbeat'

/**
 * 系统健康。
 *
 * 上云后小团队基本只有 journalctl 一个手段,而最贵的两类静默故障是:
 *   · cron 没跑 → 学生错过申请截止(不可挽回)
 *   · 支付扣了款但没履约 → 用户付了钱没开通,只能等他来投诉
 * 这一页把它们变成运营每天打开后台就能看到的东西,不需要接任何三方监控。
 */

function fmt(d: Date | null) {
  if (!d) return '从未成功'
  return d.toLocaleString('zh-CN', { hour12: false })
}

export default async function AdminHealthPage() {
  await requireAdmin('operator')

  const crons = await getCronStatuses()

  // 支付扣款超过 30 分钟仍未履约 —— 正常情况回调是秒级的
  const stuckSince = new Date(Date.now() - 30 * 60_000)
  const [stuckPayments, pendingNotifications, failedNotifications] = await Promise.all([
    db.payment.count({ where: { status: 'created', createdAt: { lt: stuckSince } } }),
    db.notification.count({ where: { status: 'pending' } }),
    db.notification.count({ where: { status: 'failed' } }),
  ])

  // 未接入的能力 —— 生产环境跑 mock 意味着对应功能对用户是坏的
  const degraded: string[] = []
  if (env.payment.provider === 'mock') degraded.push('支付(收不了款,也退不了款)')
  if (env.sms.provider === 'mock') degraded.push('短信(新用户无法注册登录)')
  if (env.llm.provider === 'mock') degraded.push('LLM(文书 AI 与采集不可用)')
  if (env.storage.provider === 'local') degraded.push('对象存储(材料存本机磁盘)')

  const cronBad = crons.filter((c) => c.overdue)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">系统健康</h1>
        <p className="mt-1 text-sm text-ink-600">
          静默故障的集中出口。这几项没人主动看的话,出事只能等用户投诉。
        </p>
      </div>

      {/* 定时任务 */}
      <Card>
        <h2 className="text-sm font-medium text-ink-900">定时任务</h2>
        <div className="mt-3 space-y-2">
          {crons.map((c) => (
            <div
              key={c.job}
              className={`rounded-lg border px-3 py-2.5 ${
                c.overdue ? 'border-red-200 bg-red-50' : 'border-ink-100'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink-900">{c.label}</span>
                <span className={`text-xs ${c.overdue ? 'text-red-700' : 'text-ink-500'}`}>
                  上次成功:{fmt(c.lastOkAt)}
                  {c.hoursSince !== null && `(${Math.floor(c.hoursSince)} 小时前)`}
                </span>
              </div>
              {c.overdue && (
                <p className="mt-1.5 text-xs leading-relaxed text-red-700">
                  超过 {c.expectedIntervalHours} 小时没有成功运行。
                  {c.job === 'deadline-reminders'
                    ? '截止提醒漏发意味着学生可能错过申请 —— 请立刻检查 /etc/cron.d/compass 与服务日志,并按 PRD 11.3 人工电话兜底。'
                    : '已交付订单会一直停在待验收,交付人拿不到结算。'}
                </p>
              )}
            </div>
          ))}
        </div>
        {cronBad.length === 0 && (
          <p className="mt-2 text-xs text-ink-400">两个任务都在正常运行。</p>
        )}
      </Card>

      {/* 支付 */}
      <Card>
        <h2 className="text-sm font-medium text-ink-900">支付</h2>
        <div
          className={`mt-3 rounded-lg border px-3 py-2.5 ${
            stuckPayments > 0 ? 'border-red-200 bg-red-50' : 'border-ink-100'
          }`}
        >
          <p className="text-sm text-ink-900">
            扣款后超 30 分钟未履约:<strong>{stuckPayments}</strong> 笔
          </p>
          {stuckPayments > 0 && (
            <p className="mt-1.5 text-xs leading-relaxed text-red-700">
              这些用户很可能已经付了钱但没开通权益。微信回调重投是有限次的,
              超时后不会再自动补 —— 需要人工核对后补履约。
            </p>
          )}
        </div>
      </Card>

      {/* 通知 */}
      <Card>
        <h2 className="text-sm font-medium text-ink-900">通知</h2>
        <p className="mt-3 text-sm text-ink-700">
          待发送 <strong>{pendingNotifications}</strong> 条 · 已作废{' '}
          <strong>{failedNotifications}</strong> 条
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-500">
          渠道未接通前,通知只在
          <Link href="/app/notifications" className="text-brand-600 hover:underline">
            站内消息
          </Link>
          可见,「待发送」堆积属预期。
          <Link href="/admin/notifications" className="ml-1 text-brand-600 hover:underline">
            去队列 →
          </Link>
        </p>
      </Card>

      {/* 未接入的能力 */}
      <Card>
        <h2 className="text-sm font-medium text-ink-900">未接入的能力</h2>
        {degraded.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">全部已接入。</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {degraded.map((d) => (
              <li key={d} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {d}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink-400">
          这些都依赖企业资质(营业执照 / 商户号 / 类目)。在它们接入之前,系统只能作为演示环境使用。
        </p>
      </Card>
    </div>
  )
}
