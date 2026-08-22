import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OrderStatus } from '@prisma/client'
import {
  ALLOWED_TRANSITIONS,
  PURCHASED_ORDER_STATUSES,
  isPurchased,
} from '@/lib/services/dispatch'
import { codeOnly } from '@/lib/source-scan'

/**
 * 「这个服务学生已经买下了」的状态名单。
 *
 * ── 为什么它有过错 ────────────────────────────────────
 *
 * 这份名单原来在三处各手写了一遍,而且三处**一模一样地漏了 disputed**:
 *
 *   /app/services 的「已购买」判定
 *   推荐引擎的 purchasedServiceCount
 *   后台 metrics 的加购率
 *
 * 三份都错,所以互相比对发现不了 —— 只有拿它跟**状态机**对照才看得出来。
 *
 * 后果里最要紧的一条:/app/services 上,已购买的服务显示「已购买」,
 * 否则显示购买按钮。而 checkoutService **没有任何重复下单检查** ——
 * 那个按钮是唯一的闸门。于是一个学生对某个服务提了异议(状态 disputed),
 * 页面上购买按钮就重新出现了,他可以为正在申诉的同一个服务再付一次钱。
 */

const ALL_STATUSES = Object.keys(ALLOWED_TRANSITIONS) as OrderStatus[]

/**
 * 从状态机推导:一个状态只要还能走到 confirmed(或它本身就是 confirmed),
 * 这笔钱就还在我们这边 —— 那就是「已购买」。
 *
 * 这样定义的好处是它**不依赖我的判断**:改了状态机,这里自动跟着变,
 * 和手写的常量一比就知道有没有人忘了同步。
 */
function reachesConfirmed(from: OrderStatus): boolean {
  const seen = new Set<OrderStatus>()
  const stack: OrderStatus[] = [from]
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === 'confirmed') return true
    if (seen.has(cur)) continue
    seen.add(cur)
    stack.push(...(ALLOWED_TRANSITIONS[cur] ?? []))
  }
  return false
}

describe('已购买名单必须和状态机一致', () => {
  it('名单 = 所有「还能走到 confirmed」的状态', () => {
    const derived = ALL_STATUSES.filter(reachesConfirmed).sort()
    expect([...PURCHASED_ORDER_STATUSES].sort()).toEqual(derived)
  })

  /**
   * ⚠️ 这一条是这组的核心。disputed 的三条出路里两条
   *    (delivering / confirmed)仍然是「买了」,只有 refunding 是退钱。
   */
  it('disputed 算已购买 —— 它还能走到 confirmed', () => {
    expect(ALLOWED_TRANSITIONS.disputed).toContain('confirmed')
    expect(isPurchased('disputed')).toBe(true)
  })

  it.each(['paid', 'assigned', 'delivering', 'delivered', 'confirmed'])('%s 算已购买', (s) => {
    expect(isPurchased(s)).toBe(true)
  })

  /** refunding 只能走到 refunded,钱在退回去的路上 */
  it.each(['pending_payment', 'cancelled', 'refunding', 'refunded'])('%s 不算已购买', (s) => {
    expect(isPurchased(s)).toBe(false)
  })

  it('未付款的不算 —— 否则下单页会以为他买过', () => {
    expect(reachesConfirmed('pending_payment')).toBe(false)
  })
})

/**
 * ⚠️ 源码守卫。
 *
 *    三处手写、三处同样漏字 —— 说明这类名单靠人抄是抄不对的。
 *    再有人内联一份,这里红。
 */
describe('源码守卫:不许再手写已购买名单', () => {
  const ROOT = process.cwd()
  const CONSUMERS = [
    'src/app/app/services/page.tsx',
    'src/lib/recommendation/engine.ts',
    'src/app/admin/metrics/page.tsx',
  ]

  it.each(CONSUMERS)('%s 用共享名单', (rel) => {
    const src = codeOnly(readFileSync(join(ROOT, rel), 'utf8')).replace(/\s+/g, ' ')
    expect(/PURCHASED_ORDER_STATUSES|isPurchased/.test(src), `${rel} 没引用共享名单`).toBe(true)
    // 内联特征:'paid' 和另一个订单状态出现在同一对方括号里
    const inlined = /\[[^\]]*'paid'[^\]]*'(assigned|delivering|delivered|confirmed)'[^\]]*\]/.test(src)
    expect(inlined, `${rel} 里又手写了一份订单状态名单`).toBe(false)
  })
})
