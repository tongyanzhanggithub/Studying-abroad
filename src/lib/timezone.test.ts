import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { localDay } from '@/lib/utils'
import { toSettlementMonth, settlementRange } from '@/lib/services/settlement-math'

/**
 * 时区回归测试。
 *
 * 这个项目的用户、交付人、财务全在中国,所有「今天」「本月」都必须是**北京时间**的。
 * 但服务器时区是部署环境决定的,阿里云 Ubuntu 镜像默认 UTC ——
 * 也就是说这几条逻辑在开发机(CST)上全对,一上云全错,而且不报任何错。
 *
 * 所以这里显式把 TZ 切成两种再跑:
 *   · Asia/Shanghai —— 生产必须是这个(deploy/compass.service 的 Environment=TZ)
 *   · UTC           —— 证明「不设时区会怎样」,以及哪些写法连设了时区也救不回来
 *
 * Node 支持运行时改 process.env.TZ,后续 new Date() 立即生效(已实测)。
 */

const ORIGINAL_TZ = process.env.TZ

function withTz(tz: string, fn: () => void) {
  process.env.TZ = tz
  try {
    fn()
  } finally {
    process.env.TZ = ORIGINAL_TZ
  }
}

beforeEach(() => {
  process.env.TZ = ORIGINAL_TZ
})
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ
})

describe('localDay —— AI 每日配额的「天」', () => {
  /**
   * 事故场景:学生北京时间 8 月 1 日凌晨 3 点写文书。
   * 对他来说这是「今天(8 月 1 日)」的第一次使用,昨天的额度应该已经清零。
   */
  const 凌晨三点北京 = new Date('2026-07-31T19:00:00Z')

  it('设了 Asia/Shanghai 时,凌晨算作新的一天', () => {
    withTz('Asia/Shanghai', () => {
      expect(localDay(凌晨三点北京)).toBe('2026-08-01')
    })
  })

  it('旧写法 toISOString() 即便设了时区依然返回 UTC 的昨天', () => {
    withTz('Asia/Shanghai', () => {
      // ⚠️ 这正是原来的 bug:toISOString 与系统时区无关,永远是 UTC。
      //    光在 systemd 里设 TZ 修不好它,必须改代码 —— 这条断言就是为了钉住这件事。
      expect(凌晨三点北京.toISOString().slice(0, 10)).toBe('2026-07-31')
      expect(localDay(凌晨三点北京)).not.toBe(凌晨三点北京.toISOString().slice(0, 10))
    })
  })

  it('白天两种写法一致 —— 所以这个 bug 在开发机上几乎撞不见', () => {
    withTz('Asia/Shanghai', () => {
      const 下午两点北京 = new Date('2026-07-31T06:00:00Z')
      expect(localDay(下午两点北京)).toBe('2026-07-31')
      expect(下午两点北京.toISOString().slice(0, 10)).toBe('2026-07-31')
    })
  })

  it('月末 / 年末不越界', () => {
    withTz('Asia/Shanghai', () => {
      expect(localDay(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-01')
      expect(localDay(new Date('2026-02-28T16:00:00Z'))).toBe('2026-03-01')
    })
  })

  it('补零 —— 配额行按字符串主键查,少一位就查不到', () => {
    withTz('Asia/Shanghai', () => {
      expect(localDay(new Date('2026-01-05T12:00:00Z'))).toBe('2026-01-05')
    })
  })
})

describe('结算月份 —— 订单算进哪个月的交付人分成', () => {
  /**
   * 事故场景:学生北京时间 8 月 1 日 03:00 点了「确认交付」。
   * 这笔单必须进 8 月的结算批次;进 7 月的话,交付人 7 月的账里
   * 就混进了一笔 8 月的单 —— 而这是要按月转给真人的钱。
   */
  const 八月一日凌晨北京 = new Date('2026-07-31T19:00:00Z')

  it('TZ=Asia/Shanghai:归入 2026-08(正确)', () => {
    withTz('Asia/Shanghai', () => {
      expect(toSettlementMonth(八月一日凌晨北京)).toBe('2026-08')
    })
  })

  it('TZ=UTC:归入 2026-07 —— 这就是不设时区的后果', () => {
    withTz('UTC', () => {
      expect(toSettlementMonth(八月一日凌晨北京)).toBe('2026-07')
    })
  })

  it('settlementRange 的边界是北京时间的月初零点', () => {
    withTz('Asia/Shanghai', () => {
      const { start, end } = settlementRange('2026-08')
      // 北京 2026-08-01 00:00 == UTC 2026-07-31 16:00
      expect(start.toISOString()).toBe('2026-07-31T16:00:00.000Z')
      expect(end.toISOString()).toBe('2026-08-31T16:00:00.000Z')
      // 上面那笔 03:00 的单落在 [start, end) 内 —— 与 toSettlementMonth 口径一致
      expect(八月一日凌晨北京 >= start && 八月一日凌晨北京 < end).toBe(true)
    })
  })

  it('12 月的区间跨到次年 1 月', () => {
    withTz('Asia/Shanghai', () => {
      const { start, end } = settlementRange('2026-12')
      expect(toSettlementMonth(start)).toBe('2026-12')
      expect(toSettlementMonth(end)).toBe('2027-01')
    })
  })
})
