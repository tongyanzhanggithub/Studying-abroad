import 'server-only'
import { db } from '@/lib/db'
import {
  aggregateSettlement,
  payoutOf,
  ratioOf,
  settlementRange,
  type SettlementRow,
} from '@/lib/services/settlement-math'

// 月份换算与分成聚合已抽到 settlement-math.ts(纯函数,可直接测)。
// 这里继续导出,免得调用方要区分从哪个文件 import。
export { toSettlementMonth, type SettlementRow } from '@/lib/services/settlement-math'

/**
 * 增值服务交付闭环(PRD 4.6 / 5.3)。
 *
 *   下单支付 → 派单 → 交付 → 学生验收(48h 无异议自动确认)
 *   → 月底与交付人结算分成
 *
 * ⚠️ 钱的事必须保守:
 *   · 学生提出异议的订单**永不**自动确认,必须运营介入
 *   · 分成金额在结算时锁定写库,不实时计算 ——
 *     否则日后调整分成比例会把历史账一起改掉
 *   · 已结算的订单不可重复结算(settlementMonth 唯一性保证)
 */

/** PRD 5.3:交付后 48 小时无异议自动确认 */
export const AUTO_CONFIRM_HOURS = 48

/**
 * 自动确认到期订单。由每日定时任务调用。
 *
 * 只处理 `delivered` 状态 —— `disputed` 的订单会被跳过,
 * 这是刻意的:学生说有问题,系统就不能替他点头。
 */
export async function runAutoConfirm(): Promise<{
  confirmed: number
  skippedDisputed: number
  errors: string[]
}> {
  const cutoff = new Date(Date.now() - AUTO_CONFIRM_HOURS * 3600_000)
  const errors: string[] = []

  /**
   * ⚠️ 一条 updateMany 搞定,不要「先 findMany 再逐条 update」。
   *    原来是 1+N 次往返,而每条要写的值完全相同;那句 `status: 'delivered'` 的
   *    竞态守卫在**单条 updateMany 的 where 里本就是原子的**,不需要拆成 N 条。
   *    积压订单越多,原写法在 IOPS 受限的 RDS 上越慢。
   */
  let confirmed = 0
  try {
    const res = await db.serviceOrder.updateMany({
      where: { status: 'delivered', deliveredAt: { lte: cutoff } },
      data: { status: 'confirmed', confirmedAt: new Date(), autoConfirmed: true },
    })
    confirmed = res.count
  } catch (err) {
    errors.push(`自动确认批量更新失败:${(err as Error).message}`)
  }

  const skippedDisputed = await db.serviceOrder.count({
    where: { status: 'disputed', deliveredAt: { lte: cutoff } },
  })

  if (errors.length) {
    console.error('[结算] 自动确认存在失败项,需人工处理:', errors)
  }

  return { confirmed, skippedDisputed, errors }
}

/**
 * 预览某月的结算明细(不写库)。
 *
 * 口径:该月内**已确认**且**尚未结算**的订单。
 * 用已确认时间而非下单时间划分月份 —— 钱在服务真正交付完成后才算数。
 */
export async function previewSettlement(month: string): Promise<SettlementRow[]> {
  const { start, end } = settlementRange(month)

  const orders = await db.serviceOrder.findMany({
    where: {
      status: 'confirmed',
      settlementMonth: null,
      confirmedAt: { gte: start, lt: end },
      delivererId: { not: null },
    },
    include: { deliverer: true },
  })

  return aggregateSettlement(orders)
}

/**
 * 执行结算:把该月已确认订单打上结算批次并锁定应付金额。
 *
 * ⚠️ 幂等:只更新 settlementMonth 为 null 的订单,重复执行不会重复计账。
 * ⚠️ 本函数**不发起真实付款** —— 只是把账算清楚并留痕,
 *    实际打款由财务在结算表外执行(MVP 阶段人工转账)。
 */
/**
 * 已锁定(已结算)的行 —— 用已写死的 payoutCents 聚合。
 *
 * ⚠️ 为什么必须有这个函数:previewSettlement 的 where 带 `settlementMonth: null`,
 *    只返回**未结算**的订单。于是点完「确认结算」之后它返回空数组,
 *    结算表、打款标记、CSV 导出三样一起从页面上消失 ——
 *    而这三样恰恰是结算**之后**才用得上的。
 *    业务上唯一合理的顺序(算账 → 锁定 → 线下转账 → 回来标记 → 导出对账)
 *    在代码里反而走不通。
 *
 * 这里用订单上**已锁定的 payoutCents**,不重新按比例算 ——
 * 锁定之后比例再变也不影响已结算的账,这正是锁定的意义。
 */
export async function getSettledRows(month: string): Promise<SettlementRow[]> {
  // 只校验格式:这里是按 settlementMonth 精确匹配,不换算区间
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`结算月份格式不对(应为 YYYY-MM):${month}`)
  }

  const orders = await db.serviceOrder.findMany({
    where: { settlementMonth: month, delivererId: { not: null } },
    include: { deliverer: true },
  })

  return aggregateSettlement(orders, { useLockedPayout: true })
}

export async function executeSettlement(month: string): Promise<{
  orderCount: number
  totalPayoutCents: number
}> {
  /**
   * ⚠️ 校验和区间换算都在 settlementRange 里,预览与锁定共用同一份 ——
   *    两边口径必须一模一样,否则「预览时看到 8 单」和「锁定了 9 单」会对不上。
   *    脏输入必须直接抛错:NaN 会让 new Date 溢出成别的月份,静默算错账。
   */
  const { start, end } = settlementRange(month)

  const orders = await db.serviceOrder.findMany({
    where: {
      status: 'confirmed',
      settlementMonth: null,
      confirmedAt: { gte: start, lt: end },
      delivererId: { not: null },
    },
    include: { deliverer: true },
  })

  const now = new Date()
  let totalPayoutCents = 0
  let orderCount = 0

  for (const o of orders) {
    if (!o.deliverer) continue
    /**
     * ⚠️ 用和预览完全同一套算法(ratioOf / payoutOf),不要在这里另写一遍。
     *    这里锁进库的数字,就是运营在预览页上看到并点了「确认结算」的那个数字。
     *    两处各写一份的话,任何一次改动都可能让「看到的」和「锁定的」对不上,
     *    而这笔钱最后是要转给真人的。
     */
    const payout = payoutOf(o, ratioOf(o))

    const res = await db.serviceOrder.updateMany({
      // settlementMonth 仍为 null 才更新 —— 并发执行时不会重复结算
      where: { id: o.id, settlementMonth: null },
      data: { settlementMonth: month, settledAt: now, payoutCents: payout },
    })

    if (res.count > 0) {
      totalPayoutCents += payout
      orderCount += 1
    }
  }

  return { orderCount, totalPayoutCents }
}
