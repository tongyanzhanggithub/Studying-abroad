import { describe, it, expect } from 'vitest'
import { deadlineWindows, DEADLINE_THRESHOLDS } from '@/lib/notifications/send'
import { daysUntil } from '@/lib/utils'

/**
 * 截止提醒的取数条件。
 *
 * 最要紧的一条:**SQL 区间和 JS 里的 daysUntil 必须是同一套口径**。
 * 现在的流程是「SQL 按区间捞 → JS 用 daysUntil 决定套哪个模板」,
 * 两边一旦对不上,捞出来的行在 JS 里全被 `continue` 掉 ——
 * 结果是一条提醒都发不出去,而且**不报任何错**。这个任务没跑等于学生错过申请。
 *
 * ⚠️ daysUntil 内部用的是**真实的当前时间**(new Date()),不接受注入。
 *    所以凡是要和它对照的用例,窗口也必须从真实 now 生成 ——
 *    写死一个日期的话,只在那一天是对的,换一天就是假绿。
 *    (这个坑我踩了:第一版用固定的 2026-07-28,恰好是当天,于是三条
 *     断言都以错误的理由通过了。)
 *    纯区间算术的用例不碰 daysUntil,可以放心用固定日期。
 */

const THRESHOLD_DAYS = DEADLINE_THRESHOLDS.map((t) => t.days)

describe('区间与 daysUntil 口径一致(用真实 now)', () => {
  it.each(THRESHOLD_DAYS)('第 %i 天区间内的时刻,daysUntil 正好返回该天数', (days) => {
    const [w] = deadlineWindows(new Date(), [days])

    expect(daysUntil(w.gte)).toBe(days) // 区间起点(本地零点)
    expect(daysUntil(new Date(w.gte.getTime() + 3600_000))).toBe(days) // 区间内
    expect(daysUntil(new Date(w.lt.getTime() - 1))).toBe(days) // 区间末尾
    expect(daysUntil(w.lt)).toBe(days + 1) // 右端点是开的,已属下一天
  })

  it('所有阈值一起生成时同样成立', () => {
    const windows = deadlineWindows(new Date(), THRESHOLD_DAYS)
    windows.forEach((w, i) => {
      expect(daysUntil(w.gte)).toBe(THRESHOLD_DAYS[i])
    })
  })
})

describe('区间算术(与当前时间无关)', () => {
  it('每个区间正好一天', () => {
    for (const w of deadlineWindows(new Date('2026-07-28T00:00:00'), THRESHOLD_DAYS)) {
      expect(w.lt.getTime() - w.gte.getTime()).toBe(86_400_000)
    }
  })

  it('四个区间互不重叠', () => {
    const sorted = deadlineWindows(new Date('2026-07-28T09:00:00'), THRESHOLD_DAYS).sort(
      (a, b) => a.gte.getTime() - b.gte.getTime(),
    )
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].gte.getTime()).toBeGreaterThanOrEqual(sorted[i - 1].lt.getTime())
    }
  })

  it('起点是本地零点 —— 当天什么时候跑结果都一样', () => {
    // 定时任务定在 9:00,但重试或手动触发可能是任意时刻
    const early = deadlineWindows(new Date('2026-07-28T00:00:01'), [7])[0]
    const late = deadlineWindows(new Date('2026-07-28T23:59:59'), [7])[0]
    expect(early.gte.getTime()).toBe(late.gte.getTime())
    expect(early.gte.getHours()).toBe(0)
    expect(early.gte.getMinutes()).toBe(0)
    expect(early.gte.getSeconds()).toBe(0)
  })

  it('跨月:7/28 + 7 天 = 8/4', () => {
    const [w] = deadlineWindows(new Date('2026-07-28T09:00:00'), [7])
    expect(w.gte.getMonth()).toBe(7) // 0-based
    expect(w.gte.getDate()).toBe(4)
  })

  it('跨年:12/28 + 14 天 = 次年 1/11', () => {
    const [w] = deadlineWindows(new Date('2026-12-28T09:00:00'), [14])
    expect(w.gte.getFullYear()).toBe(2027)
    expect(w.gte.getMonth()).toBe(0)
    expect(w.gte.getDate()).toBe(11)
  })

  it('闰年 2/28 + 1 天 = 2/29', () => {
    const [w] = deadlineWindows(new Date('2028-02-28T09:00:00'), [1])
    expect(w.gte.getMonth()).toBe(1)
    expect(w.gte.getDate()).toBe(29)
  })
})
