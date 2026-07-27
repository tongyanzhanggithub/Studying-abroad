import { describe, it, expect } from 'vitest'
import {
  aggregateSettlement,
  payoutOf,
  ratioOf,
  settlementRange,
  toSettlementMonth,
  type SettlementOrderLike,
} from './settlement-math'

const DELIVERER = {
  id: 'd1',
  name: '张老师',
  role: '选校规划',
  wxContact: 'wx_zhang',
  splitRatio: 0.6,
}

function order(over: Partial<SettlementOrderLike> = {}): SettlementOrderLike {
  return {
    amountCents: 100_000, // ¥1000
    splitRatio: null,
    payoutCents: null,
    deliverer: DELIVERER,
    ...over,
  }
}

// ── 月份 ────────────────────────────────────────────────

describe('toSettlementMonth', () => {
  it('个位月份补零', () => {
    expect(toSettlementMonth(new Date(2026, 0, 15))).toBe('2026-01')
    expect(toSettlementMonth(new Date(2026, 8, 1))).toBe('2026-09')
  })

  it('十位月份不补零', () => {
    expect(toSettlementMonth(new Date(2026, 11, 31))).toBe('2026-12')
  })
})

describe('settlementRange —— 区间', () => {
  it('普通月份是半开区间 [1 号, 下月 1 号)', () => {
    const { start, end } = settlementRange('2026-07')
    expect(start).toEqual(new Date(2026, 6, 1))
    expect(end).toEqual(new Date(2026, 7, 1))
  })

  /** 12 月的下一个月要跨年,这是最容易写错的一处 */
  it('12 月的区间上界是次年 1 月 1 日', () => {
    const { start, end } = settlementRange('2026-12')
    expect(start).toEqual(new Date(2026, 11, 1))
    expect(end).toEqual(new Date(2027, 0, 1))
  })

  it('2 月按实际天数走,闰年也不用特判', () => {
    expect(settlementRange('2028-02').end).toEqual(new Date(2028, 2, 1))
  })
})

describe('settlementRange —— 脏输入必须抛错,不能静默算错月份', () => {
  /**
   * ⚠️ 这条是这次抽取的直接动因。
   *    原来 previewSettlement 只校验「非空」,'2026-13' 会让 new Date(2026, 12, 1)
   *    溢出成 2027-01-01 —— 页面会把**次年一月**的账当成「2026-13 月」显示出来,
   *    不报错、数字看着也正常。钱的口径上这比直接崩掉糟糕得多。
   */
  it('月份 13 不合法', () => {
    expect(() => settlementRange('2026-13')).toThrow(/不合法/)
  })

  it('月份 00 不合法', () => {
    expect(() => settlementRange('2026-00')).toThrow(/不合法/)
  })

  it.each(['2026-7', '26-07', '2026/07', '', 'abcd-ef', '2026-07-01'])(
    '格式不对:%s',
    (bad) => {
      expect(() => settlementRange(bad)).toThrow(/格式不对/)
    },
  )
})

// ── 单笔分成 ────────────────────────────────────────────

describe('ratioOf —— 比例取值优先级', () => {
  it('优先用下单时锁定的比例', () => {
    expect(ratioOf(order({ splitRatio: 0.7 }))).toBe(0.7)
  })

  it('没锁定才回退到交付人当前比例', () => {
    expect(ratioOf(order({ splitRatio: null }))).toBe(0.6)
  })

  /**
   * ⚠️ 锁定值是 0 时必须当成 0,不能被 ?? 之外的写法(如 ||)吞掉变成 0.6 ——
   *    那会给一个约定不分成的订单凭空发出 60% 的钱。
   */
  it('锁定比例为 0 时就是 0,不会回退', () => {
    expect(ratioOf(order({ splitRatio: 0 }))).toBe(0)
  })
})

describe('payoutOf —— 取整', () => {
  it('整除的情况', () => {
    expect(payoutOf(order({ amountCents: 100_000 }), 0.6)).toBe(60_000)
  })

  it('除不尽时四舍五入到分', () => {
    // 99900 * 1/3 = 33300 整除;取一个真的除不尽的
    expect(payoutOf(order({ amountCents: 99_999 }), 1 / 3)).toBe(33_333)
    expect(payoutOf(order({ amountCents: 12_345 }), 0.655)).toBe(8_086) // 8085.975
  })

  it('比例为 0 时应付为 0', () => {
    expect(payoutOf(order({ amountCents: 88_888 }), 0)).toBe(0)
  })
})

// ── 聚合 ────────────────────────────────────────────────

describe('aggregateSettlement —— 基本口径', () => {
  it('按交付人汇总单数、流水、应付', () => {
    const rows = aggregateSettlement([
      order({ amountCents: 100_000 }),
      order({ amountCents: 50_000 }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      delivererId: 'd1',
      delivererName: '张老师',
      orderCount: 2,
      grossCents: 150_000,
      payoutCents: 90_000,
      platformCents: 60_000,
    })
  })

  /**
   * ⚠️ 平台留成必须是「流水 − 应付」,不能另外按 (1−ratio) 算一遍。
   *    两边各自 Math.round 会在除不尽时差 1 分,账就永远平不了。
   */
  it('平台留成 + 应付 恒等于流水(除不尽时也成立)', () => {
    const rows = aggregateSettlement([
      order({ amountCents: 99_999, splitRatio: 1 / 3 }),
      order({ amountCents: 12_345, splitRatio: 0.655 }),
    ])
    const r = rows[0]
    expect(r.payoutCents + r.platformCents).toBe(r.grossCents)
  })

  it('没有交付人的订单不参与分成', () => {
    const rows = aggregateSettlement([order({ deliverer: null }), order()])
    expect(rows).toHaveLength(1)
    expect(rows[0].orderCount).toBe(1)
  })

  it('空清单返回空数组,不抛错', () => {
    expect(aggregateSettlement([])).toEqual([])
  })

  it('多个交付人按应付金额从大到小排', () => {
    const other = { ...DELIVERER, id: 'd2', name: '李老师' }
    const rows = aggregateSettlement([
      order({ amountCents: 10_000 }),
      order({ amountCents: 90_000, deliverer: other }),
    ])
    expect(rows.map((r) => r.delivererId)).toEqual(['d2', 'd1'])
  })
})

describe('aggregateSettlement —— 结算后用锁定金额', () => {
  /**
   * 锁定的意义就是「之后比例再怎么变都不影响这笔已结的账」。
   * 这里故意让交付人当前比例(0.6)和锁定金额(70000,即 70%)不一致。
   */
  it('useLockedPayout 时用订单上的 payoutCents,不重新按比例算', () => {
    const rows = aggregateSettlement(
      [order({ amountCents: 100_000, payoutCents: 70_000 })],
      { useLockedPayout: true },
    )
    expect(rows[0].payoutCents).toBe(70_000)
    expect(rows[0].platformCents).toBe(30_000)
  })

  it('锁定值缺失时回退到现算,不会算成 0', () => {
    const rows = aggregateSettlement([order({ amountCents: 100_000, payoutCents: null })], {
      useLockedPayout: true,
    })
    expect(rows[0].payoutCents).toBe(60_000)
  })

  it('不开 useLockedPayout 时忽略锁定值(预览口径)', () => {
    const rows = aggregateSettlement([order({ amountCents: 100_000, payoutCents: 70_000 })])
    expect(rows[0].payoutCents).toBe(60_000)
  })
})

describe('aggregateSettlement —— 已知缺陷:同一人多种比例时展示的比例对不上', () => {
  /**
   * ⚠️ 这条不是在验证「正确」,是在**钉住当前行为**,免得改动时误以为已经修好了。
   *
   *    月中在后台改过某位交付人的分成比例,当月就会同时存在两种比例。
   *    金额是逐笔算的、没有错;但结算表显示的比例取自**第一笔**订单,
   *    于是财务看到的一行是「流水 2000 × 60% = 应付 1300」—— 对不上,
   *    会被当成系统算错了。
   *
   *    修法(待定):把展示比例改成实际比例 payoutCents / grossCents。
   */
  it('展示比例取第一笔,导致 流水 × 比例 ≠ 应付', () => {
    const rows = aggregateSettlement([
      order({ amountCents: 100_000, splitRatio: 0.6 }),
      order({ amountCents: 100_000, splitRatio: 0.7 }),
    ])
    const r = rows[0]
    expect(r.grossCents).toBe(200_000)
    expect(r.payoutCents).toBe(130_000) // 金额逐笔算,是对的
    expect(r.splitRatio).toBe(0.6) // 展示的比例只是第一笔的
    expect(Math.round(r.grossCents * r.splitRatio)).not.toBe(r.payoutCents)
  })
})
