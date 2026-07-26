import { NextResponse, type NextRequest } from 'next/server'
import { runDeadlineReminders } from '@/lib/notifications/send'
import { isValidCronSecret } from '@/lib/cron-auth'
import { recordCronSuccess } from '@/lib/cron-heartbeat'

/**
 * 每日截止日期提醒任务。
 * 由外部定时器(云函数定时触发 / crontab curl)每天调用一次。
 *
 * ⚠️ 用共享密钥保护,避免被公网随意触发造成重复推送。
 */
export async function POST(request: NextRequest) {
  if (!isValidCronSecret(request.headers.get('x-cron-secret'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const result = await runDeadlineReminders()

  // 只有全部成功才记心跳 —— 有失败项还记的话,等于假装任务是好的
  if (result.errors.length === 0) await recordCronSuccess('deadline-reminders')

  // 有失败项时返回 500,让上游监控能抓到告警(PRD 11.3:立即人工电话兜底)
  const status = result.errors.length ? 500 : 200
  return NextResponse.json(result, { status })
}
