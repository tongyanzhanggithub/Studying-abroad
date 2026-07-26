import { NextResponse, type NextRequest } from 'next/server'
import { runAutoConfirm } from '@/lib/services/settlement'
import { isValidCronSecret } from '@/lib/cron-auth'
import { recordCronSuccess } from '@/lib/cron-heartbeat'

/**
 * 服务订单 48h 自动确认(PRD 5.3)。
 * 由外部定时器每日调用一次。
 *
 * ⚠️ 用共享密钥保护 —— 这个接口会推进订单状态、进而影响结算,
 *    不能让公网随意触发。
 */
export async function POST(request: NextRequest) {
  if (!isValidCronSecret(request.headers.get('x-cron-secret'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const result = await runAutoConfirm()

  // 只有全部成功才记心跳(见 cron-heartbeat.ts)
  if (result.errors.length === 0) await recordCronSuccess('auto-confirm')

  // 有失败项时返回 500,让上游监控抓到告警
  return NextResponse.json(result, { status: result.errors.length ? 500 : 200 })
}
