import { describe, it, expect } from 'vitest'
import { computeExpiresAt } from './fulfill'

const d = (s: string) => new Date(`${s}T00:00:00+08:00`)
const ymd = (x: Date) =>
  `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`

/**
 * 到期日计算。
 *
 * 这里锁住的是一个**真实修过的 bug**:JS 的 `setMonth` 在目标月天数不足时会往后
 * 溢出(1/31 + 1 月 → 3/3),每次白送 1~3 天。没有测试的话下次重构极易改回去。
 */
describe('computeExpiresAt —— 跨月边界不能溢出', () => {
  it.each([
    // [基准日, 月数, 期望到期日]
    ['2026-01-31', 1, '2026-02-28'], // 2 月只有 28 天
    ['2026-08-31', 1, '2026-09-30'], // 9 月只有 30 天
    ['2026-03-31', 1, '2026-04-30'], // 4 月只有 30 天
    ['2026-05-31', 3, '2026-08-31'], // 8 月有 31 天,应保留 31
    ['2026-01-31', 12, '2027-01-31'], // 整年,同为 31 天
    ['2026-07-15', 1, '2026-08-15'], // 普通日期不受影响
    ['2026-07-15', 3, '2026-10-15'],
    ['2026-07-15', 12, '2027-07-15'],
  ])('%s + %i 个月 = %s', (start, months, expected) => {
    expect(ymd(computeExpiresAt(d(start), null, months))).toBe(expected)
  })

  it('闰年 2 月:1/31 + 1 月 = 2/29', () => {
    expect(ymd(computeExpiresAt(d('2028-01-31'), null, 1))).toBe('2028-02-29')
  })
})

describe('computeExpiresAt —— 续费接续', () => {
  it('未到期时从原到期日往后接,不损失剩余天数', () => {
    // 今天 7/26,原到期日 10/31,续 12 个月 → 应为次年 10/31,而不是 次年 7/26
    expect(ymd(computeExpiresAt(d('2026-07-26'), d('2026-10-31'), 12))).toBe('2027-10-31')
  })

  it('已过期时从今天算起,不把过去的时间也算进去', () => {
    expect(ymd(computeExpiresAt(d('2026-07-26'), d('2026-01-01'), 1))).toBe('2026-08-26')
  })

  it('恰好今天到期,按今天算', () => {
    expect(ymd(computeExpiresAt(d('2026-07-26'), d('2026-07-26'), 1))).toBe('2026-08-26')
  })

  it('续费永远让到期日往后,不会缩短', () => {
    for (const months of [1, 3, 12]) {
      const now = d('2026-07-26')
      const current = d('2026-12-31')
      expect(computeExpiresAt(now, current, months).getTime()).toBeGreaterThan(current.getTime())
    }
  })
})
