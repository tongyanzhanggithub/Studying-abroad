import { NextResponse, type NextRequest } from 'next/server'
import { runRetentionCleanup } from '@/lib/retention'
import { isValidCronSecret } from '@/lib/cron-auth'
import { recordCronSuccess } from '@/lib/cron-heartbeat'

/**
 * 每日数据保留期清理(PIPL 第 19 条)。
 * 由 crontab 每天调用一次,保留期定义见 lib/retention.ts。
 *
 * ⚠️ 和其他定时任务一样用共享密钥保护 —— 这个接口会**删数据**,
 *    公网上裸奔的删除接口是不能接受的。
 */
export async function POST(request: NextRequest) {
  if (!isValidCronSecret(request.headers.get('x-cron-secret'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const result = await runRetentionCleanup()

  // 只有全部成功才记心跳 —— 有失败项还记的话,等于假装任务是好的
  if (result.errors.length === 0) await recordCronSuccess('retention')

  const status = result.errors.length ? 500 : 200
  return NextResponse.json(result, { status })
}
