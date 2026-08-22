import { describe, it, expect } from 'vitest'
import { sanitizeDeadlines } from '@/lib/programs/deadline-sanitize'

/**
 * `Program.finalDeadline` 这一列的产生规则。
 *
 * 全站每一个倒计时都读它:院校库卡片、仪表盘、材料中心的「赶不上」、
 * 行动计划、每日提醒短信。它算错一格,上面全部跟着错 ——
 * 而它此前**一条测试都没有**,因为埋在导入脚本里根本调不到。
 *
 * ⚠️ 口径已定(2026-08-19):倒计时表示**申请通道关闭**,
 *    所以这一列只认 final_deadline,不拿轮次日期顶替。
 *    这一组用例先是行为快照(抽函数时钉现状),口径定下来之后
 *    改成了断言新口径 —— 下面那一组的名字从「⚠️ 待定」变成了结论。
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

  /**
   * ⚠️ 口径变更点。旧行为是退回轮次里那个未来日期(2027-01-10),
   *    新口径下**不顶替** —— 官网没给出这一届的通道关闭日,我们就不宣布一个。
   *    详情页照样列出轮次表,学生看得到 2027-01-10,只是卡片不做倒计时。
   */
  it('不拿轮次日期顶替,倒计时置空', () => {
    expect(r.finalDeadline).toBeNull()
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
 * ── 有轮次时:倒计时指向通道关闭,不是下一轮 ─────────────
 *
 * 旧行为取「所有已知日期里最早的未来日期」,而那批日期同时包含各轮次 ——
 * 于是列里存的是**下一轮**,卡片却写「还有 N 天截止」,而那天什么都不会关闭。
 *
 * 拿 data/raw 的 310 个项目实测(以 2026-09-01 为今天):
 *   76 个有未来的最终截止日,其中 **31 个(41%)**倒计时指向的是更早的轮次。
 *   最夸张的 UBC Master of Management:倒计时到 2026-10-06,
 *   而通道 2027-05-04 才关 —— 早了七个月,学生会以为自己错过了。
 *
 * 只有 1 个项目(NUS 供应链)因为这次改动失去倒计时:
 * 它的最终截止日缺失,只剩轮次 —— 那种情况下我们不宣布关闭日。
 */
describe('有轮次时,倒计时指向申请通道关闭', () => {
  const raw = {
    final_deadline: '2027-03-01',
    rounds: [
      { name: '第 1 轮', deadline: '2026-10-15' },
      { name: '第 2 轮', deadline: '2027-01-10' },
    ],
  }

  it('列里存的是最终截止日,不是第 1 轮', () => {
    expect(day(sanitizeDeadlines(raw, TODAY).finalDeadline)).toBe('2027-03-01')
  })

  it('和详情页那个「最终截止」是同一天 —— 两页不再打架', () => {
    const r = sanitizeDeadlines(raw, TODAY)
    expect(day(r.finalDeadline)).toBe(r.deadlines.final_deadline)
  })

  it('轮次表原样保留,详情页照样列得出来', () => {
    expect(sanitizeDeadlines(raw, TODAY).deadlines.rounds).toHaveLength(2)
  })

  /** 轮次一个个过去,通道关闭日不动 —— 这正是「关闭」该有的语义 */
  it('第 1 轮过去后倒计时不变', () => {
    const later = new Date('2026-11-01T00:00:00+08:00')
    expect(day(sanitizeDeadlines(raw, later).finalDeadline)).toBe('2027-03-01')
  })

  /**
   * ⚠️ 没有可用的最终截止日时**不拿最后一轮顶替**。
   *    顶替等于我们替官网宣布了一个它没说过的关闭日期。
   */
  it('只有轮次、没有最终截止日 → 不倒计时,并在 notes 里说明', () => {
    const r = sanitizeDeadlines({ rounds: [{ name: '第 2 轮', deadline: '2027-02-28' }] }, TODAY)
    expect(r.finalDeadline).toBeNull()
    expect(r.deadlines.notes).toContain('未给出申请通道关闭日')
    expect(r.deadlines.rounds).toHaveLength(1)
  })
})
