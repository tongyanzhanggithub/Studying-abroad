'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { computeExpiresAt } from '@/lib/payment/fulfill'

/**
 * 用户 / 会员管理。
 *
 * ── 为什么需要这一页 ────────────────────────────────────
 * 此前后台**完全没有**用户管理:客服日常的「按手机号查用户」「看他的季票和订单」
 * 「延长有效期」「补发权益」「重置 AI 配额」全部只能连数据库改。
 * 生产环境让人手改库是事故温床 —— 一次 where 写漏就是灾难。
 *
 * ⚠️ 所有会改动权益的动作都要求 super_admin,并写审计留痕:
 *    这些操作直接等价于发钱,必须能追溯到人。
 */

/** 延长 / 补发季票有效期 */
export async function extendSubscription(
  subscriptionId: string,
  months: number,
  reason: string,
) {
  const admin = await requireAdmin('super_admin')

  if (!Number.isInteger(months) || months < 1 || months > 24) {
    return { ok: false as const, error: '延长月数请填 1-24 的整数' }
  }
  if (!reason.trim()) {
    return { ok: false as const, error: '要写明原因 —— 这是发钱的操作,必须留痕备查' }
  }

  const sub = await db.subscription.findUnique({ where: { id: subscriptionId } })
  if (!sub) return { ok: false as const, error: '订阅不存在' }

  // 复用支付履约里同一套到期日计算(已处理跨月溢出),避免两套口径
  const expiresAt = computeExpiresAt(new Date(), sub.expiresAt, months)

  await db.subscription.update({
    where: { id: subscriptionId },
    data: {
      expiresAt,
      // 补发时若已过期,要重新激活,否则用户仍进不去
      status: 'active',
    },
  })

  console.log(
    JSON.stringify({
      event: 'admin.subscription_extended',
      adminId: admin.adminId,
      subscriptionId,
      months,
      newExpiresAt: expiresAt.toISOString(),
      reason: reason.trim(),
    }),
  )

  revalidatePath('/admin/users')
  return { ok: true as const, expiresAt }
}

/** 重置某用户当天的 AI 配额(客服兜底:模型抽风白扣了次数) */
export async function resetAiQuota(userId: string) {
  const admin = await requireAdmin('operator')

  const day = new Date().toISOString().slice(0, 10)
  await db.aiUsageDaily.updateMany({
    where: { userId, day },
    data: { count: 0 },
  })

  console.log(
    JSON.stringify({ event: 'admin.ai_quota_reset', adminId: admin.adminId, userId, day }),
  )

  revalidatePath('/admin/users')
  return { ok: true as const }
}
