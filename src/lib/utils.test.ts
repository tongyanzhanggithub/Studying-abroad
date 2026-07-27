import { describe, it, expect } from 'vitest'
import {
  countWords,
  daysUntil,
  deadlineUrgency,
  formatCents,
  formatDate,
  generateOutTradeNo,
  renderTemplate,
} from './utils'

// ════════════════════════════════════════════════════════
// 金额
// ════════════════════════════════════════════════════════

describe('formatCents —— 金额一律以分存储,展示时转元', () => {
  it('整元不显示小数', () => {
    expect(formatCents(0)).toBe('¥0')
    expect(formatCents(3000)).toBe('¥30')
    expect(formatCents(499900)).toBe('¥4,999')
  })

  it('有零头才显示两位小数', () => {
    expect(formatCents(123456)).toBe('¥1,234.56')
    expect(formatCents(99)).toBe('¥0.99')
  })

  /** 1 分钱也不能显示成 ¥0 —— 结算对账会因此对不上 */
  it('最小单位 1 分', () => {
    expect(formatCents(1)).toBe('¥0.01')
  })

  it('千分位分隔', () => {
    expect(formatCents(100_000_000)).toBe('¥1,000,000')
  })

  /** 退款场景会出现负数 */
  it('负数不丢符号', () => {
    expect(formatCents(-500)).toBe('¥-5')
  })
})

// ════════════════════════════════════════════════════════
// 日期
// ════════════════════════════════════════════════════════

/** 相对今天偏移 n 天的本地日期(daysUntil 按本地零点比较) */
function localDate(offsetDays: number): Date {
  const d = new Date()
  d.setHours(12, 0, 0, 0) // 中午,避免夏令时/边界抖动
  d.setDate(d.getDate() + offsetDays)
  return d
}

describe('daysUntil', () => {
  it('今天是 0 天', () => {
    expect(daysUntil(localDate(0))).toBe(0)
  })

  it('未来是正数,过去是负数', () => {
    expect(daysUntil(localDate(7))).toBe(7)
    expect(daysUntil(localDate(-3))).toBe(-3)
  })

  /**
   * ⚠️ 必须按**本地零点**比较,不能按毫秒差。
   *    按毫秒差的话「今晚 23:00 截止」在早上会算成 0 天、在晚上算成 0 天但
   *    跨零点后突然变 -1,倒计时会在用户眼皮底下跳。
   */
  it('同一天的不同时刻都算 0 天', () => {
    const early = new Date()
    early.setHours(0, 5, 0, 0)
    const late = new Date()
    late.setHours(23, 55, 0, 0)
    expect(daysUntil(early)).toBe(0)
    expect(daysUntil(late)).toBe(0)
  })

  it('接受 ISO 字符串', () => {
    const iso = localDate(5).toISOString().slice(0, 10)
    expect(daysUntil(iso)).toBe(5)
  })

  it('空值返回 null(表示「待公布」,不是 0 天)', () => {
    expect(daysUntil(null)).toBeNull()
    expect(daysUntil(undefined)).toBeNull()
    expect(daysUntil('')).toBeNull()
  })

  /** 采集来的脏数据不能变成 NaN 天,那会渲染成「还有 NaN 天截止」 */
  it('非法日期返回 null', () => {
    expect(daysUntil('明年五月')).toBeNull()
    expect(daysUntil('2026-13-45')).toBeNull()
  })
})

describe('deadlineUrgency —— 倒计时配色(PRD 4.3)', () => {
  it('3 天内 critical,7 天内 warning,更远 normal', () => {
    expect(deadlineUrgency(0)).toBe('critical')
    expect(deadlineUrgency(3)).toBe('critical')
    expect(deadlineUrgency(4)).toBe('warning')
    expect(deadlineUrgency(7)).toBe('warning')
    expect(deadlineUrgency(8)).toBe('normal')
  })

  it('已过期是 past,未知是 none —— 两者不能混为一谈', () => {
    expect(deadlineUrgency(-1)).toBe('past')
    expect(deadlineUrgency(null)).toBe('none')
  })
})

describe('formatDate', () => {
  it('空值显示「待公布」而不是空白或 Invalid Date', () => {
    expect(formatDate(null)).toBe('待公布')
    expect(formatDate(undefined)).toBe('待公布')
    expect(formatDate('')).toBe('待公布')
  })

  it('非法日期也显示「待公布」', () => {
    expect(formatDate('不是日期')).toBe('待公布')
  })

  it('正常日期渲染成中文长格式', () => {
    expect(formatDate('2026-11-30T00:00:00+08:00')).toContain('2026')
    expect(formatDate('2026-11-30T00:00:00+08:00')).toContain('11')
  })
})

// ════════════════════════════════════════════════════════
// 文案模板
// ════════════════════════════════════════════════════════

describe('renderTemplate', () => {
  it('替换已知占位符', () => {
    expect(renderTemplate('你有 {n} 所高风险冲刺', { n: 3 })).toBe('你有 3 所高风险冲刺')
    expect(renderTemplate('{school} 面试', { school: '牛津大学' })).toBe('牛津大学 面试')
  })

  it('同一占位符出现多次都替换', () => {
    expect(renderTemplate('{n} / {n}', { n: 2 })).toBe('2 / 2')
  })

  /**
   * ⚠️ 未提供的占位符**保留原样**,不能替换成 undefined ——
   *    运营看到「{pct}」会知道是自己漏配了变量,看到「undefined% 的用户」
   *    只会以为系统坏了,而这句话已经推给用户了。
   */
  it('未提供的占位符原样保留', () => {
    expect(renderTemplate('{pct}% 的用户', {})).toBe('{pct}% 的用户')
    expect(renderTemplate('{n} 和 {unknown}', { n: 1 })).toBe('1 和 {unknown}')
  })

  it('值为 0 时照常替换,不被当成空', () => {
    expect(renderTemplate('还有 {days} 天', { days: 0 })).toBe('还有 0 天')
  })

  it('没有占位符时原样返回', () => {
    expect(renderTemplate('纯文案', { n: 1 })).toBe('纯文案')
  })
})

// ════════════════════════════════════════════════════════
// 字数统计(文书超字数是不可被声明绕过的硬约束)
// ════════════════════════════════════════════════════════

describe('countWords', () => {
  it('英文按空格切词', () => {
    expect(countWords('hello world')).toBe(2)
  })

  it('中文按字符计', () => {
    expect(countWords('我爱学习')).toBe(4)
  })

  it('中英混排两者相加', () => {
    expect(countWords('I love 学习 very much')).toBe(6)
  })

  it('空白与空串都是 0', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   \n\t ')).toBe(0)
  })

  /** 连字符词、撇号词算一个词 —— 否则 state-of-the-art 会被算成 4 个 */
  it('连字符与撇号不拆词', () => {
    expect(countWords('state-of-the-art')).toBe(1)
    expect(countWords('don’t stop')).toBe(2)
  })

  it('标点不计入', () => {
    expect(countWords('Hello, world! 你好。')).toBe(4)
  })
})

// ════════════════════════════════════════════════════════
// 商户订单号
// ════════════════════════════════════════════════════════

describe('generateOutTradeNo', () => {
  it('带前缀,长度符合微信支付要求(≤32)', () => {
    const no = generateOutTradeNo('SUB')
    expect(no.startsWith('SUB')).toBe(true)
    expect(no.length).toBeLessThanOrEqual(32)
  })

  it('只含微信允许的字符(字母数字)', () => {
    expect(generateOutTradeNo('SVC')).toMatch(/^[A-Za-z0-9]+$/)
  })

  /** 撞号会导致第二笔订单被当成重复回调直接丢弃 —— 收了钱不发货 */
  it('连续生成 500 个不重复', () => {
    const set = new Set(Array.from({ length: 500 }, () => generateOutTradeNo('SUB')))
    expect(set.size).toBe(500)
  })
})
