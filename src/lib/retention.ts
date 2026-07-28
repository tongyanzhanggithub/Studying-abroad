import 'server-only'
import { db } from '@/lib/db'

/**
 * 数据保留期清理(PIPL 第 19 条:保存期限应为实现处理目的所必要的**最短**时间)。
 *
 * 在这之前项目里一处清理都没有 —— 每一条验证码、每一次页面曝光、每一版文书
 * 都是永久保留的。三张表里最要紧的是验证码:它存着**手机号 + 来源 IP**,
 * 而这两样是全库里最直接的个人信息。
 *
 * ⚠️ 每一项的保留期都必须说得出理由,不能拍脑袋。下面每个常量都写了它的依据。
 * ⚠️ 只删「确实没用了」的行。宁可多留一点,也不能删掉还在被业务读的数据 ——
 *    这个任务是自动跑的,删错了没有回头路(只能翻备份)。
 */

/**
 * 验证码:24 小时。
 *
 * 依据:限流真正需要的窗口是 **1 小时** —— lib/auth/verification.ts 里
 * 按手机号和按 IP 的两道闸门查的都是 `createdAt >= hourAgo`,验证码本身
 * TTL 只有几分钟。也就是说一小时前的行对业务已经零价值。
 *
 * 留到 24 小时是给排障留的余量(「我昨晚收不到验证码」这类工单要能查),
 * 再多就纯粹是在攒手机号和 IP 了。
 */
const VERIFICATION_CODE_HOURS = 24

/**
 * 埋点事件:180 天。
 *
 * 依据:看板查的是近 7 天(countEvents(name, since))。留半年是为了能做
 * 同比和回溯分析 —— 招生是有季节性的,只留一个月看不出「今年比去年差」。
 * 再往前的原始事件没人会去翻,该做的是留汇总而不是留明细。
 */
const ANALYTICS_EVENT_DAYS = 180

/**
 * 文书版本:365 天,且**永不删当前版本**。
 *
 * 依据:文书是学生付了钱产出的核心资产,删早了是砸自己招牌。一整个申请季
 * 大约 9-12 个月,留满一年意味着「这一季的东西一直都在」。
 *
 * ⚠️ 当前版本(essay.currentVersionId)无论多老都必须留 —— 它就是学生现在
 *    看到的正文。删掉它等于把人家文书删了。
 * ⚠️ 带 label 的版本也留(润色前、终稿):那些是刻意封存的留痕,
 *    出现学术诚信争议时是唯一依据,不能因为过了一年就没了。
 */
const ESSAY_VERSION_DAYS = 365

export interface RetentionResult {
  verificationCodes: number
  analyticsEvents: number
  essayVersions: number
  errors: string[]
}

/**
 * 跑一遍清理。由每日定时任务调用。
 *
 * 三项互相独立 —— 任何一项失败都记进 errors 继续跑下一项,
 * 不让一张表的问题把整个清理任务卡死。
 */
export async function runRetentionCleanup(now: Date = new Date()): Promise<RetentionResult> {
  const errors: string[] = []
  const ms = now.getTime()

  let verificationCodes = 0
  try {
    const res = await db.verificationCode.deleteMany({
      where: { createdAt: { lt: new Date(ms - VERIFICATION_CODE_HOURS * 3600_000) } },
    })
    verificationCodes = res.count
  } catch (err) {
    errors.push(`验证码清理失败:${(err as Error).message}`)
  }

  let analyticsEvents = 0
  try {
    const res = await db.analyticsEvent.deleteMany({
      where: { createdAt: { lt: new Date(ms - ANALYTICS_EVENT_DAYS * 86_400_000) } },
    })
    analyticsEvents = res.count
  } catch (err) {
    errors.push(`埋点清理失败:${(err as Error).message}`)
  }

  let essayVersions = 0
  try {
    /**
     * ⚠️ 必须先把所有 currentVersionId 捞出来排除掉。
     *    currentVersionId 在 schema 里只是个 `String? @unique`,**不是外键** ——
     *    数据库不会拦着你删掉它指向的那一行。删了之后学生打开文书,
     *    页面按 `take: 1` 取到的是更早的版本,他会看到自己的文书**变回了旧稿**,
     *    而且没有任何报错。
     */
    const current = await db.essay.findMany({
      where: { currentVersionId: { not: null } },
      select: { currentVersionId: true },
    })
    const keepIds = current
      .map((e) => e.currentVersionId)
      .filter((id): id is string => id !== null)

    const res = await db.essayVersion.deleteMany({
      where: {
        createdAt: { lt: new Date(ms - ESSAY_VERSION_DAYS * 86_400_000) },
        id: { notIn: keepIds },
        // 刻意封存的留痕(润色前 / 终稿)不清
        label: null,
      },
    })
    essayVersions = res.count
  } catch (err) {
    errors.push(`文书版本清理失败:${(err as Error).message}`)
  }

  const summary = { verificationCodes, analyticsEvents, essayVersions }
  if (errors.length) {
    console.error(JSON.stringify({ event: 'retention.partial_failure', ...summary, errors }))
  } else {
    console.info(JSON.stringify({ event: 'retention.done', ...summary }))
  }

  return { ...summary, errors }
}

/** 导出仅为可测与文档用途 —— 保留期改动应当是显式的 */
export const RETENTION_POLICY = {
  verificationCodeHours: VERIFICATION_CODE_HOURS,
  analyticsEventDays: ANALYTICS_EVENT_DAYS,
  essayVersionDays: ESSAY_VERSION_DAYS,
} as const
