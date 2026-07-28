import 'server-only'
import { db } from '@/lib/db'

/**
 * 定时任务心跳。
 *
 * ── 为什么需要 ──────────────────────────────────────────
 * 两个 cron(截止提醒、48h 自动确认)失败时会返回 500,日志进
 * /var/log/compass-cron.log —— 但**没有任何东西会去读那个日志**。
 * 更糟的是「cron 根本没跑」这种情况(文件被覆盖、crond 挂了、密钥不匹配 401)
 * 连日志都不会有,系统里零信号。
 *
 * 后果不对称:auto-confirm 没跑 = 交付人晚拿钱(可补);
 * 截止提醒没跑 = **学生错过申请**,不可挽回。所以必须能看出来。
 *
 * 复用 AppSetting 这张 key-value 表,不新增 model。
 */

export type CronJob = 'deadline-reminders' | 'auto-confirm' | 'retention'

/** 各任务的预期间隔(小时)—— 超过这个值还没成功过就该告警 */
export const CRON_EXPECTED_INTERVAL_HOURS: Record<CronJob, number> = {
  // 每日 9:00 跑;给足冗余,超过 26 小时没成功即异常
  'deadline-reminders': 26,
  // 每日 9:10 跑
  'auto-confirm': 26,
  // 每日 4:30 跑 —— 数据保留期清理(PIPL 第 19 条)
  'retention': 26,
}

function keyOf(job: CronJob) {
  return `cron.${job}.lastOkAt`
}

/** 任务成功跑完时记一次心跳。失败不记 —— 记了就等于假装成功。 */
export async function recordCronSuccess(job: CronJob): Promise<void> {
  const now = new Date().toISOString()
  try {
    await db.appSetting.upsert({
      where: { key: keyOf(job) },
      create: { key: keyOf(job), value: now, updatedBy: 'cron' },
      update: { value: now, updatedBy: 'cron' },
    })
  } catch (err) {
    // 心跳写失败不能影响任务本身的结果
    console.error(JSON.stringify({ event: 'cron.heartbeat_write_failed', job, err: String(err) }))
  }
}

export interface CronStatus {
  job: CronJob
  label: string
  lastOkAt: Date | null
  hoursSince: number | null
  /** 超期未成功,或从未成功过 */
  overdue: boolean
  expectedIntervalHours: number
}

const LABEL: Record<CronJob, string> = {
  'deadline-reminders': '截止日期提醒',
  'auto-confirm': '服务订单自动确认',
  'retention': '数据保留期清理',
}

export async function getCronStatuses(): Promise<CronStatus[]> {
  /**
   * ⚠️ 从 CRON_EXPECTED_INTERVAL_HOURS 推导,不要在这里手写第二份清单。
   *    原来是硬编码的数组 —— 新增一个任务时很容易只加了间隔配置、忘了加这里,
   *    结果健康页上**根本不显示那个任务**,而「看不见」正好等于「一直是好的」,
   *    这恰恰是这个心跳机制想防的事。
   */
  const jobs = Object.keys(CRON_EXPECTED_INTERVAL_HOURS) as CronJob[]
  const rows = await db.appSetting.findMany({
    where: { key: { in: jobs.map(keyOf) } },
  })
  const byKey = new Map(rows.map((r) => [r.key, r.value]))

  return jobs.map((job) => {
    const raw = byKey.get(keyOf(job))
    const lastOkAt = raw ? new Date(raw) : null
    const valid = lastOkAt && !Number.isNaN(lastOkAt.getTime()) ? lastOkAt : null
    const hoursSince = valid ? (Date.now() - valid.getTime()) / 3600_000 : null
    const expected = CRON_EXPECTED_INTERVAL_HOURS[job]
    return {
      job,
      label: LABEL[job],
      lastOkAt: valid,
      hoursSince,
      // 从未成功过也算异常 —— 部署后没配 cron 是最常见的漏配
      overdue: hoursSince === null || hoursSince > expected,
      expectedIntervalHours: expected,
    }
  })
}
