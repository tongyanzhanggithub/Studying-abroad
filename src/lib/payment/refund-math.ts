/**
 * 退款的纯计算部分。
 *
 * ── 为什么单独抽出来 ──────────────────────────────────
 *
 * 和 settlement-math.ts 是同一个理由,而且这次有实证:
 *
 *   1. **这是钱。** 退多了是真金白银的损失,退少了是纠纷,必须能直接写测试。
 *   2. 原来它埋在 payment/index.ts 里,而那个文件顶上 `import { env }` ——
 *      模块一加载就要求 DATABASE_URL 存在。于是这几个**完全不碰数据库的
 *      纯函数根本没法单测**,只能靠人眼看。
 *
 *      代价是实打实的:calcSubscriptionRefund 里那句
 *      `daysSincePaid <= 7 && coreModuleUseCount < 3` 的后半段,
 *      因为 coreModuleUseCount 全项目只读不写、永远是 0,从来没有生效过 ——
 *      而定价页、首页 FAQ、用户协议上都白纸黑字写着这个条件。
 *      说的和做的不一致,而且没有任何测试发现得了,因为压根没有测试。
 *
 * 本文件**不 import env、不 import db**,保持可直接跑。
 */

export interface RefundDecision {
  allowed: boolean
  /** 可退金额(分) */
  refundableCents: number
  reason: string
}

/** 无理由全额退款的天数 —— 对外文案、协议、这里必须是同一个数 */
export const FULL_REFUND_DAYS = 7

/**
 * 系统季票退款计算。
 *   · 购买 7 天内 → 全退,不附加条件
 *   · 之后按剩余月份阶梯退
 *
 * ── 为什么把「核心功能使用 <3 次」这个条件删掉了 ──────────
 *
 * 原来的判定是 `daysSincePaid <= 7 && coreModuleUseCount < 3`,而
 * Subscription.coreModuleUseCount 这个字段**全项目只有读、没有写** ——
 * 没有任何代码给它加过 1,它永远是 0。于是 `0 < 3` 恒真,
 * 整条规则实际等价于「7 天内就全退」,后半个条件从来没生效过。
 *
 * 也就是说定价页、首页 FAQ、用户协议上写的「且核心功能使用少于 3 次」,
 * 系统从来没有执行过 —— 说的和做的不一致。
 *
 * 两个方向都能修:补上计数,或者把承诺改成无条件。选了后者,因为:
 *   1. 分散在多处的计数器正是它当初腐烂成死字段的原因 —— 要在四五个
 *      写入口都记得 +1,漏一处判定就不准,而且不会有人发现
 *   2. 套餐价位在 ¥30–306,「买来猛用一周再退」的实际风险很小
 *   3. **无条件七天退款本身是更好的卖点**,也更容易向用户解释 ——
 *      「你用了 3 次所以不能全退」这种判定,用户一定会来争「我明明只点了 2 次」
 *
 * ⚠️ 改这里就必须同步改四处对外文案(定价页 ×2、首页 FAQ、用户协议),
 *    refund-policy.test.ts 会盯着它们别再出现「少于 3 次」。
 */
export function calcSubscriptionRefund(params: {
  amountCents: number
  paidAt: Date
  expiresAt: Date | null
}): RefundDecision {
  const { amountCents, paidAt, expiresAt } = params
  const daysSincePaid = (Date.now() - paidAt.getTime()) / 86_400_000

  if (daysSincePaid <= FULL_REFUND_DAYS) {
    return {
      allowed: true,
      refundableCents: amountCents,
      reason: `购买 ${FULL_REFUND_DAYS} 天内,可全额退款`,
    }
  }

  if (!expiresAt) {
    return { allowed: false, refundableCents: 0, reason: '该订阅无到期日,不支持按月退款' }
  }

  const totalMs = expiresAt.getTime() - paidAt.getTime()
  const remainingMs = expiresAt.getTime() - Date.now()
  if (remainingMs <= 0) {
    return { allowed: false, refundableCents: 0, reason: '订阅已到期,不可退款' }
  }

  const remainingMonths = Math.floor(remainingMs / (30 * 86_400_000))
  const totalMonths = Math.max(1, Math.round(totalMs / (30 * 86_400_000)))
  if (remainingMonths < 1) {
    return { allowed: false, refundableCents: 0, reason: '剩余不足 1 个月,不可退款' }
  }

  const refundable = Math.floor((amountCents * remainingMonths) / totalMonths)
  return {
    allowed: true,
    refundableCents: refundable,
    reason: `按剩余 ${remainingMonths} 个月/共 ${totalMonths} 个月阶梯退款`,
  }
}

/**
 * 单点服务退款计算。
 *   · 交付人接单前 → 全退
 *   · 接单后交付前 → 退 50%
 *   · 交付后 → 不退
 */
export function calcServiceRefund(params: {
  amountCents: number
  assignedAt: Date | null
  deliveredAt: Date | null
}): RefundDecision {
  const { amountCents, assignedAt, deliveredAt } = params

  if (deliveredAt) {
    return { allowed: false, refundableCents: 0, reason: '服务已交付,不支持退款' }
  }
  if (assignedAt) {
    return {
      allowed: true,
      refundableCents: Math.floor(amountCents / 2),
      reason: '交付人已接单但尚未交付,可退 50%',
    }
  }
  return {
    allowed: true,
    refundableCents: amountCents,
    reason: '交付人尚未接单,可全额退款',
  }
}
