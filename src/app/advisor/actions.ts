'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdvisor } from '@/lib/auth/session'
import { canTransition, ORDER_STATUS_LABEL } from '@/lib/services/dispatch'
import { notifyServiceOrder } from '@/lib/notifications/send'
import type { OrderStatus } from '@prisma/client'

/**
 * 顾问对自己订单的操作。
 *
 * ⚠️ 每一个动作都必须带 `delivererId` 条件去查订单。
 *    只在页面上「只列出自己的单」是不够的 —— server action 是公开端点,
 *    知道别人的 orderId 就能直接调。归属校验必须在服务端每次都做。
 */
async function ownedOrder(orderId: string) {
  const session = await requireAdvisor()
  if (!session.delivererId) return { session, order: null }

  const order = await db.serviceOrder.findFirst({
    where: { id: orderId, delivererId: session.delivererId },
  })
  return { session, order }
}

export async function advisorStartWork(orderId: string) {
  const { order } = await ownedOrder(orderId)
  if (!order) return { ok: false as const, error: '订单不存在,或不是派给你的。' }

  if (!canTransition(order.status, 'delivering')) {
    return {
      ok: false as const,
      error: `当前是「${ORDER_STATUS_LABEL[order.status]}」,不能标记为交付中。`,
    }
  }

  await db.serviceOrder.update({ where: { id: orderId }, data: { status: 'delivering' } })
  revalidatePath('/advisor')
  revalidatePath('/admin/dispatch')
  return { ok: true as const }
}

/**
 * 顾问提交交付。
 *
 * 交付说明必填 —— 服务是线下交付的,系统里只有一个状态位的话,
 * 学生说「没收到」时双方各执一词,运营没有任何依据判断。
 */
export async function advisorDeliver(
  orderId: string,
  note: string,
  url: string,
) {
  const { order } = await ownedOrder(orderId)
  if (!order) return { ok: false as const, error: '订单不存在,或不是派给你的。' }

  if (!note.trim()) {
    return { ok: false as const, error: '要写交付说明:交付了什么、什么时候、学生该去哪看。' }
  }

  const target: OrderStatus = 'delivered'
  if (!canTransition(order.status, target)) {
    return {
      ok: false as const,
      error: `当前是「${ORDER_STATUS_LABEL[order.status]}」,不能直接标记为已交付。`,
    }
  }

  await db.serviceOrder.update({
    where: { id: orderId },
    data: {
      status: target,
      deliveredAt: new Date(),
      deliveryNote: note.trim().slice(0, 1000),
      deliveryUrl: url.trim() || null,
    },
  })

  await notifyServiceOrder(orderId, 'service_delivered')

  revalidatePath('/advisor')
  revalidatePath('/admin/dispatch')
  revalidatePath('/app/orders')
  return { ok: true as const }
}
