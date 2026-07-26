import 'server-only'
import { db } from '@/lib/db'

/**
 * 站内消息(收件箱)读取。
 *
 * 「未读」= clickedAt 为空。复用已有字段,不新增列。
 *
 * ⚠️ 不展示 status='failed' 的:那是运营在后台「作废」掉的条目
 *    (见 admin/notifications/actions.ts),不该再出现在用户面前。
 */

export interface InboxItem {
  id: string
  title: string
  body: string
  createdAt: Date
  read: boolean
}

/** 未读条数 —— 导航红点用,尽量轻 */
export async function countUnread(userId: string): Promise<number> {
  return db.notification.count({
    where: { userId, clickedAt: null, status: { not: 'failed' } },
  })
}

/** 收件箱列表 */
export async function listInbox(userId: string, take = 50): Promise<InboxItem[]> {
  const rows = await db.notification.findMany({
    where: { userId, status: { not: 'failed' } },
    orderBy: { createdAt: 'desc' },
    take,
    select: { id: true, payload: true, createdAt: true, clickedAt: true },
  })

  return rows.map((r) => {
    // payload 里存了渲染好的 title/body(见 notifications/send.ts 的 createNotification)
    const p = (r.payload ?? {}) as Record<string, unknown>
    return {
      id: r.id,
      title: typeof p.title === 'string' && p.title ? p.title : '来自 Compass 的提醒',
      body: typeof p.body === 'string' ? p.body : '',
      createdAt: r.createdAt,
      read: r.clickedAt !== null,
    }
  })
}
