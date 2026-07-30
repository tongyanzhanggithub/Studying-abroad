import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { codeOnly } from '@/lib/source-scan'
import { calcSubscriptionRefund, FULL_REFUND_DAYS } from '@/lib/payment/refund-math'

/**
 * 退款规则:代码与对外承诺必须一致。
 *
 * ── 这里出过什么事 ────────────────────────────────────
 *
 * 判定原本是 `daysSincePaid <= 7 && coreModuleUseCount < 3`,
 * 而 Subscription.coreModuleUseCount 这个字段**全项目只有读、没有写** ——
 * 没有任何代码给它加过 1,永远是 0,于是 `0 < 3` 恒真。
 * 整条规则实际等价于「7 天内就全退」,后半个条件从来没生效过。
 *
 * 也就是说定价页、首页 FAQ、用户协议上写了三年的「且核心功能使用少于 3 次」,
 * 系统一次都没有执行过。**说的和做的不一致**,而且没有任何测试发现得了 ——
 * 因为没有测试同时看这两边。
 *
 * 现在承诺改成无条件 7 天全退。下面这组用例的意义就是把
 * 「代码怎么算」和「页面怎么说」钉在一起。
 */

const ROOT = process.cwd()
const day = 86_400_000

function daysAgo(n: number) {
  return new Date(Date.now() - n * day)
}

describe('7 天内无条件全退', () => {
  it('刚买就退 —— 全额', () => {
    const r = calcSubscriptionRefund({
      amountCents: 24300,
      paidAt: daysAgo(0),
      expiresAt: daysAgo(-270),
    })
    expect(r.allowed).toBe(true)
    expect(r.refundableCents).toBe(24300)
  })

  it('第 7 天仍然全额 —— 边界是包含的', () => {
    const r = calcSubscriptionRefund({
      amountCents: 24300,
      paidAt: daysAgo(6.9),
      expiresAt: daysAgo(-270),
    })
    expect(r.refundableCents).toBe(24300)
  })

  it('理由里不再提「使用次数」', () => {
    const r = calcSubscriptionRefund({
      amountCents: 24300,
      paidAt: daysAgo(1),
      expiresAt: daysAgo(-270),
    })
    expect(r.reason).not.toContain('次')
  })

  it('过了 7 天转成按月阶梯,不再全额', () => {
    const r = calcSubscriptionRefund({
      amountCents: 30600,
      paidAt: daysAgo(60),
      expiresAt: daysAgo(-305),
    })
    expect(r.allowed).toBe(true)
    expect(r.refundableCents).toBeLessThan(30600)
  })

  /**
   * ⚠️ 退款金额永远不能超过实付。这条和「使用次数」无关,
   *    但它是这个函数最不能出错的一条 —— 多退就是真金白银的损失。
   */
  it.each([0, 1, 7, 30, 100, 300])('第 %i 天退款都不超过实付', (d) => {
    const r = calcSubscriptionRefund({
      amountCents: 24300,
      paidAt: daysAgo(d),
      expiresAt: daysAgo(d - 270),
    })
    expect(r.refundableCents).toBeLessThanOrEqual(24300)
    expect(r.refundableCents).toBeGreaterThanOrEqual(0)
  })

  it('已到期不给退', () => {
    const r = calcSubscriptionRefund({
      amountCents: 24300,
      paidAt: daysAgo(400),
      expiresAt: daysAgo(30),
    })
    expect(r.allowed).toBe(false)
  })
})

describe('对外文案与代码同步', () => {
  const pages = {
    定价页: readFileSync(join(ROOT, 'src/app/pricing/page.tsx'), 'utf8'),
    首页: readFileSync(join(ROOT, 'src/app/page.tsx'), 'utf8'),
    用户协议: readFileSync(join(ROOT, 'src/app/legal/terms/page.tsx'), 'utf8'),
  }

  /**
   * ⚠️ 这是这组用例的核心:任何一处再出现「少于 3 次」,
   *    就说明有人把一个**代码里根本不存在**的条件写回了对外承诺。
   */
  it.each(Object.entries(pages))('%s 不再声称「少于 3 次」', (_name, src) => {
    expect(src).not.toContain('少于 3 次')
    expect(src).not.toContain('少于三次')
  })

  it.each(Object.entries(pages))('%s 写明了 7 天', (_name, src) => {
    expect(src).toMatch(/7 天|七天/)
  })

  it('代码里的天数常量就是 7 —— 改了它必须同步改文案', () => {
    expect(FULL_REFUND_DAYS).toBe(7)
  })
})

describe('死字段已经清干净', () => {
  /**
   * coreModuleUseCount 是「加了字段、写了规则、但从没接上写入」的典型。
   * 留着一个永远为 0 的字段,只会让下一个人再困惑一次 —— 一并删掉。
   */
  it('schema 里不再有 coreModuleUseCount', () => {
    const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8')
    expect(schema).not.toContain('coreModuleUseCount')
  })

  it.each([
    'app/app/orders/actions.ts',
    'app/app/orders/page.tsx',
  ])('%s 不再传这个参数', (rel) => {
    const src = codeOnly(readFileSync(join(ROOT, 'src', rel), 'utf8'))
    expect(src).not.toContain('coreModuleUseCount')
  })
})
