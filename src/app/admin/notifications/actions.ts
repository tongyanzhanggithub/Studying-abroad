'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'

/**
 * 待发送通知队列的人工兜底。
 *
 * ⚠️ 这里的「已人工通知」是**如实记账**,不是把问题划掉。
 *    运营真的打了电话、发了微信之后才点 —— 系统无法验证这一点,
 *    所以文案上必须写清楚,并且记下是谁点的。
 *    如果只是想让红色告警消失而点它,那是在骗自己:
 *    积压数字归零了,用户还是没收到。
 */
export async function markNotifiedManually(ids: string[], note: string) {
  const admin = await requireAdmin('operator')
  if (ids.length === 0) return { ok: true as const, count: 0 }

  const res = await db.notification.updateMany({
    where: { id: { in: ids }, status: 'pending' },
    data: {
      status: 'sent',
      sentAt: new Date(),
      // 复用 error 字段记录兜底方式 —— 不为此单开一列,
      // 渠道接通之后这条路径本来就该消失
      error: `人工兜底(${admin.adminId})${note.trim() ? `:${note.trim().slice(0, 200)}` : ''}`,
    },
  })

  revalidatePath('/admin/notifications')
  revalidatePath('/admin/metrics')
  return { ok: true as const, count: res.count }
}

/** 明确作废:模板配错、用户已注销等,不需要补发 */
export async function discardNotifications(ids: string[], reason: string) {
  const admin = await requireAdmin('operator')
  if (!reason.trim()) {
    return { ok: false as const, error: '作废要写原因,否则事后查不清为什么没发。' }
  }
  const res = await db.notification.updateMany({
    where: { id: { in: ids }, status: 'pending' },
    data: {
      status: 'failed',
      error: `人工作废(${admin.adminId}):${reason.trim().slice(0, 200)}`,
    },
  })
  revalidatePath('/admin/notifications')
  revalidatePath('/admin/metrics')
  return { ok: true as const, count: res.count }
}
