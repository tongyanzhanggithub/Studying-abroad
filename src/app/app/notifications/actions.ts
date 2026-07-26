'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'

/**
 * 站内消息中心的服务端动作。
 *
 * ── 为什么需要站内消息 ──────────────────────────────────
 * 通知系统的投递渠道(微信订阅消息 / 短信 / 邮件)全部依赖企业资质,
 * 资质到位前 deliver() 是个空实现,所有通知永远停在 pending ——
 * 而「截止前 14/7/3/1 天提醒」「选校数据变更推送」「服务交付通知」
 * 都是首页与定价页明确承诺的**付费权益**。
 *
 * 站内消息把已经落库的这些通知变成用户**看得见**的东西,
 * 不依赖任何外部资质。渠道接通后,这里与推送并存,不冲突。
 *
 * 「已读」复用 clickedAt / status='clicked' —— schema 里本来就有这两个字段,
 * 不新增列。
 */

/** 把指定消息标为已读;只能操作自己的。 */
export async function markRead(notificationId: string) {
  const user = await requireUser()
  // ⚠️ where 带 userId —— server action 是公开端点,知道别人的 id 就能直接调
  await db.notification.updateMany({
    where: { id: notificationId, userId: user.id, clickedAt: null },
    data: { status: 'clicked', clickedAt: new Date() },
  })
  revalidatePath('/app/notifications')
  return { ok: true as const }
}

/** 全部标为已读。 */
export async function markAllRead() {
  const user = await requireUser()
  const res = await db.notification.updateMany({
    where: { userId: user.id, clickedAt: null },
    data: { status: 'clicked', clickedAt: new Date() },
  })
  revalidatePath('/app/notifications')
  revalidatePath('/app/dashboard')
  return { ok: true as const, count: res.count }
}
