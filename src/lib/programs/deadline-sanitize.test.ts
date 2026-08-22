import { describe, it, expect } from 'vitest'
import { sanitizeDeadlines } from '@/lib/programs/deadline-sanitize'

/**
 * `Program.finalDeadline` 这一列的产生规则。
 *
 * 全站每一个倒计时都读它:院校库卡片、仪表盘、材料中心的「赶不上」、
 * 行动计划、每日提醒短信。它算错一格,上面全部跟着错 ——
 * 而它此前**一条测试都没有**,因为埋在导入脚本里根本调不到。
 *
 * ⚠️ 这一组是**行为快照**,不是「应该怎样」的主张。
 *    函数是原样搬过来的,这些用例先把现状钉死;真要改口径时,
 *    改动会在这里显形,而不是悄悄改变全站倒计时。
 */

const TODAY = new Date('2026-09-01T00:00:00+08:00')
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

describe('整届过期:所有日期都在今天之前', () => {
  const r = sanitizeDeadlines(
    {
      opens_at: '2025-09-01',
      final_deadline: '2026-06-26',
      rounds: [{ name: '第 1 轮', deadline: '2026-01-10' }],
      notes: '原始备注',
    },
    TODAY,
  )

  it('倒计时数据源置空 —— 不能拿上一届的日期做规划', () => {
    expect(r.finalDeadline).toBeNull()
  })

  it('轮次表清空,JSON 里的日期也一并置空', () => {
    expect(r.deadlines.rounds).toEqual([])
    expect(r.deadlines.final_deadline).toBeNull()
    expect(r.deadlines.opens_at).toBeNull()
  })

  /** 原始日期必须留档 —— 运营核对时要知道我们采到过什么 */
  it('原始日期存进 notes,不是直接丢掉', () => {
    expect(r.deadlines.notes).toContain('2026-06-26')
    expect(r.deadlines.notes).toContain('2026-01-10')
    expect(r.deadlines.notes).toContain('原始备注')
  })

  it('标记为降级,导入脚本据此告警', () => {
    expect(r.downgraded).toBe(true)
  })
})

describe('只有最终截止日过期(轮次表已更新)', () => {
  const r = sanitizeDeadlines(
    {
      final_deadline: '2026-06-26',
      rounds: [{ name: '第 2 轮', deadline: '2027-01-10' }],
    },
    TODAY,
  )

  it('过期的最终截止日被置空,而不是留着显示负天数', () => {
    expect(r.deadlines.final_deadline).toBeNull()
  })

  it('倒计时改用轮次里那个未来日期', () => {
    expect(day(r.finalDeadline)).toBe('2027-01-10')
  })

  it('notes 说清楚为什么置空了', () => {
    expect(r.deadlines.notes).toContain('2026-06-26')
    expect(r.deadlines.notes).toContain('已过期')
  })

  it('算降级', () => {
    expect(r.downgraded).toBe(true)
  })
})

describe('正常周期', () => {
  it('只有最终截止日时,两处取值一致', () => {
    const r = sanitizeDeadlines({ final_deadline: '2027-03-01', rounds: [] }, TODAY)
    expect(day(r.finalDeadline)).toBe('2027-03-01')
    expect(r.deadlines.final_deadline).toBe('2027-03-01')
    expect(r.downgraded).toBe(false)
  })

  it('一个日期都没有 → null,前端显示「截止日待公布」', () => {
    const r = sanitizeDeadlines({ rounds: [] }, TODAY)
    expect(r.finalDeadline).toBeNull()
    expect(r.deadlines.final_deadline).toBeNull()
    expect(r.downgraded).toBe(false)
  })

  it('raw 整个为空也不炸', () => {
    expect(sanitizeDeadlines(null, TODAY).finalDeadline).toBeNull()
    expect(sanitizeDeadlines(undefined, TODAY).downgraded).toBe(false)
  })

  it('rounds 里的 null 项被过滤掉,不参与计算', () => {
    const r = sanitizeDeadlines(
      { final_deadline: '2027-03-01', rounds: [null as never, { deadline: null }] },
      TODAY,
    )
    expect(day(r.finalDeadline)).toBe('2027-03-01')
  })

  it('解析不出来的日期字符串当作没有', () => {
    const r = sanitizeDeadlines({ final_deadline: '待公布', rounds: [] }, TODAY)
    expect(r.finalDeadline).toBeNull()
  })

  /**
   * 边界:今天当天截止仍算「未来」,不提前判死。
   *
   * ⚠️ 断言时刻而不是 ISO 字符串。第一版写的是
   *      expect(day(r.finalDeadline)).toBe('2026-08-31')
   *    —— 它能过(+08:00 的零点转成 UTC 就是前一天 16:00),但读起来
   *    像是日期倒退了一天,把时区换算当成了被测行为。要测的是
   *    「等于今天不算过期」,那就直接比时刻。
   */
  it('恰好等于今天的日期算未来,不判过期', () => {
    const r = sanitizeDeadlines({ final_deadline: '2026-09-01T00:00:00+08:00', rounds: [] }, TODAY)
    expect(r.finalDeadline?.getTime()).toBe(TODAY.getTime())
    expect(r.downgraded).toBe(false)
  })

  /** 早一毫秒就算过去了 —— 边界的另一侧 */
  it('比今天早一毫秒就算上一届', () => {
    const justBefore = new Date(TODAY.getTime() - 1).toISOString()
    const r = sanitizeDeadlines({ final_deadline: justBefore, rounds: [] }, TODAY)
    expect(r.finalDeadline).toBeNull()
    expect(r.downgraded).toBe(true)
  })
})

/**
 * ── 已知的口径分歧,没有改,只是钉住 ──────────────────
 *
 * finalDeadline 取「所有已知日期里最早的未来日期」,而 allDates 同时包含
 * final_deadline 和**各轮次的截止日**。于是有轮次的项目,
 * 列里存的其实是**下一轮**的日期,而不是最终截止日。
 *
 * 结果是同一个项目两页两个日期:
 *   院校库卡片 / 仪表盘   「还有 44 天截止」  ← 第 1 轮 10-15
 *   详情页「最终截止」     2027-03-01
 * 而 10-15 那天其实什么都不会关闭。
 *
 * ⚠️ 两种改法都说得通,取决于产品意图:
 *      · 倒计时想指向「下一个该动手的日期」→ 现在的取值是对的,该改的是文案
 *        (「还有 N 天截止」应改成「下一轮还有 N 天」)
 *      · 倒计时想指向「申请通道关闭」→ 该只看 final_deadline
 *    没定之前不动它 —— 这一列喂着全站所有倒计时,改错了影响面比这个歧义本身大。
 *
 * 这两条用例的作用是:谁真去改的时候,会先看到它们红,并读到上面这段。
 */
describe('⚠️ 待定:有轮次时,finalDeadline 存的是下一轮而不是最终截止', () => {
  const raw = {
    final_deadline: '2027-03-01',
    rounds: [
      { name: '第 1 轮', deadline: '2026-10-15' },
      { name: '第 2 轮', deadline: '2027-01-10' },
    ],
  }

  it('列里存的是第 1 轮的日期(倒计时用这个)', () => {
    expect(day(sanitizeDeadlines(raw, TODAY).finalDeadline)).toBe('2026-10-15')
  })

  it('JSON 里的最终截止日保持原值(详情页用这个)', () => {
    expect(sanitizeDeadlines(raw, TODAY).deadlines.final_deadline).toBe('2027-03-01')
  })

  it('两处确实不一致 —— 这就是分歧本身', () => {
    const r = sanitizeDeadlines(raw, TODAY)
    expect(day(r.finalDeadline)).not.toBe(r.deadlines.final_deadline)
  })

  /** 第 1 轮过去之后,倒计时自动挪到第 2 轮 —— 不会变成负数,这部分是对的 */
  it('第 1 轮过去后自动挪到第 2 轮', () => {
    const later = new Date('2026-11-01T00:00:00+08:00')
    expect(day(sanitizeDeadlines(raw, later).finalDeadline)).toBe('2027-01-10')
  })
})
