/**
 * 结算的纯计算部分 —— 月份区间与分成聚合。
 *
 * 从 settlement.ts 抽出来的原因有两个:
 *
 *   1. **这是钱。** 算错分成是要跟真人对账的,必须能直接写测试。
 *      原来这段逻辑埋在三个都要连库的 async 函数里,测不了。
 *   2. **原来写了三遍。** previewSettlement(结算前预览)、executeSettlement(锁定)、
 *      getSettledRows(结算后展示)各有一份几乎相同的聚合。三份一旦漂移,
 *      「点结算前看到的数」「锁进库里的数」「结算后页面上的数」就会互相对不上,
 *      而且没有任何地方会报错。收成一份之后不可能漂移。
 *
 * 本文件**不 import db**,也不带 'server-only' —— 它得能被测试直接跑。
 */

/** 结算月份格式 YYYY-MM */
export function toSettlementMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * 把 "YYYY-MM" 换算成半开区间 [start, end)。
 *
 * ⚠️ 校验必须放在这里,而不是各调用方自己写。
 *    原来 executeSettlement 校验了 1..12,previewSettlement 只校验了「非空」——
 *    于是 previewSettlement('2026-13') 不会报错,`new Date(2026, 12, 1)` 溢出成
 *    2027-01-01,页面会把**下一年一月**的账当成「2026-13 月」显示出来。
 *    钱的口径上,静默算错比直接报错糟糕得多。
 */
export function settlementRange(month: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`结算月份格式不对(应为 YYYY-MM):${month}`)
  }
  const [year, mon] = month.split('-').map(Number)
  if (!year || !mon || mon < 1 || mon > 12) {
    throw new Error(`结算月份不合法:${month}`)
  }
  // mon=12 时 new Date(year, 12, 1) 正好是次年 1 月 1 日,跨年不用特判
  return { start: new Date(year, mon - 1, 1), end: new Date(year, mon, 1) }
}

export interface SettlementRow {
  delivererId: string
  delivererName: string
  role: string
  wxContact: string | null
  /**
   * 展示用的分成比例 = 应付 ÷ 流水。
   *
   * ⚠️ 不是「这个人的分成比例」,是**这一行的实际比例**。区别只在月中调过比例时
   *    才显现,但那时区别很要命:原来这里放的是该交付人当月**第一笔**订单的比例,
   *    于是表格里「流水 × 比例 ≠ 应付」—— 财务对账时会当成我们算错了钱,
   *    而金额本身是逐笔算的、一分不差,错的只是这个展示用的比例。
   *    改成实际比例后,这一行的三个数字永远自洽。
   *
   * 当月只有一种比例时,它就精确等于那个比例(见测试)。
   */
  effectiveRatio: number
  /**
   * 这一行实际用到的分成比例,去重后从小到大。
   *
   * 长度 > 1 表示当月调过比例 —— 此时 effectiveRatio 是个加权平均值,
   * 界面要把这件事说出来,否则运营会以为我们把他的比例改成了一个没见过的数。
   */
  ratios: number[]
  orderCount: number
  grossCents: number
  payoutCents: number
  platformCents: number
}

/** 聚合只需要这些字段,不绑 Prisma 的完整模型,测试才好造数据 */
export interface SettlementOrderLike {
  amountCents: number
  /** 派单时锁定的比例;为空则回退到交付人当前比例 */
  splitRatio: number | null
  /** 结算时锁定的应付金额;只有已结算的订单才有 */
  payoutCents: number | null
  deliverer: {
    id: string
    name: string
    role: string
    wxContact: string | null
    splitRatio: number
  } | null
}

/**
 * 单笔订单的应付分成。
 *
 * ⚠️ 金额一律以**分**为单位取整。先按比例算再 round,不要先 round 比例 ——
 *    后者在 1/3 这类比例上会逐笔多算或少算几分钱,几百单累积起来就是对不上的账。
 */
export function payoutOf(order: SettlementOrderLike, ratio: number): number {
  return Math.round(order.amountCents * ratio)
}

/** 该笔订单适用的分成比例:下单时的快照优先,缺失才用交付人当前值 */
export function ratioOf(order: SettlementOrderLike): number {
  return order.splitRatio ?? order.deliverer?.splitRatio ?? 0
}

/**
 * 比例转百分比字符串。整数不带小数位,加权平均出来的带一位。
 *
 * ⚠️ 不能用 `Number.isInteger(ratio * 100)` 判整数 —— 浮点下
 *    `0.65 * 100 === 65.00000000000001`,65% 会被渲染成「65.000000000000014%」。
 *    先四舍五入到一位小数再除,整数自然落回整数。
 */
export function formatRatioPercent(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10}%`
}

/**
 * 按交付人聚合。
 *
 * @param useLockedPayout 结算**之后**的展示要用订单上已锁定的 payoutCents,
 *   不能重新按比例算 —— 锁定之后比例再变也不该影响已结算的账,这正是锁定的意义。
 *   结算**之前**的预览没有锁定值,按比例现算。
 *
 * 排序按应付金额从大到小,方便运营先处理大额。
 */
export function aggregateSettlement(
  orders: SettlementOrderLike[],
  { useLockedPayout = false }: { useLockedPayout?: boolean } = {},
): SettlementRow[] {
  /** 先按交付人累加金额,比例最后统一由「应付 ÷ 流水」反算 */
  type Acc = Omit<SettlementRow, 'effectiveRatio' | 'ratios'> & { ratios: Set<number> }
  const byDeliverer = new Map<string, Acc>()

  for (const o of orders) {
    // 没有交付人的订单不参与分成(理论上查询已过滤,这里再兜一层)
    if (!o.deliverer) continue

    const ratio = ratioOf(o)
    const payout =
      useLockedPayout && o.payoutCents !== null ? o.payoutCents : payoutOf(o, ratio)

    const row = byDeliverer.get(o.deliverer.id) ?? {
      delivererId: o.deliverer.id,
      delivererName: o.deliverer.name,
      role: o.deliverer.role,
      wxContact: o.deliverer.wxContact,
      ratios: new Set<number>(),
      orderCount: 0,
      grossCents: 0,
      payoutCents: 0,
      platformCents: 0,
    }

    row.ratios.add(ratio)
    row.orderCount += 1
    row.grossCents += o.amountCents
    row.payoutCents += payout
    // 平台留成 = 流水 - 应付,不单独按 (1-ratio) 算 —— 否则两边各自取整会差 1 分
    row.platformCents += o.amountCents - payout
    byDeliverer.set(o.deliverer.id, row)
  }

  return [...byDeliverer.values()]
    .map(({ ratios, ...row }) => ({
      ...row,
      /**
       * 反算而不是取某一笔的比例 —— 这样「流水 × 比例 = 应付」在表格上永远成立。
       * 流水为 0 时不做除法(理论上不会有 0 元订单,但除零会得到 NaN,
       * 而 NaN% 会原样渲染到财务看的表格里)。
       */
      effectiveRatio: row.grossCents === 0 ? 0 : row.payoutCents / row.grossCents,
      ratios: [...ratios].sort((a, b) => a - b),
    }))
    .sort((a, b) => b.payoutCents - a.payoutCents)
}
