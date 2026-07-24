'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { canTransition, ORDER_STATUS_LABEL } from '@/lib/services/dispatch'
import { notifyServiceOrder } from '@/lib/notifications/send'
import type { OrderStatus } from '@prisma/client'

/**
 * 派单 / 改派。
 *
 * ⚠️ 分成比例在派单这一刻**快照**到订单上。之后在交付人管理里调比例,
 *    不会影响已经派出去的单 —— 否则调一次比例会把历史账全改写。
 */
export async function assignOrder(orderId: string, delivererId: string, note: string) {
  await requireAdmin('operator')

  const [order, deliverer] = await Promise.all([
    db.serviceOrder.findUnique({ where: { id: orderId }, include: { sku: true } }),
    db.deliverer.findUnique({ where: { id: delivererId } }),
  ])
  if (!order) return { ok: false as const, error: '订单不存在' }
  if (!deliverer) return { ok: false as const, error: '交付人不存在' }
  if (!deliverer.active) return { ok: false as const, error: `${deliverer.name} 已停用,不能派单给他/她。` }

  /**
   * ⚠️ 已交付之后不允许改派。
   *    改派会把 splitRatio 换成新交付人的比例,等于把钱记到没干活的人头上;
   *    真做错了人应该走异议流程,留下处理记录,而不是悄悄改一个字段。
   */
  const REASSIGNABLE: OrderStatus[] = ['paid', 'assigned', 'delivering']
  if (!REASSIGNABLE.includes(order.status)) {
    return {
      ok: false as const,
      error: `订单当前是「${ORDER_STATUS_LABEL[order.status]}」,不能再改派。派错人请走异议处理,留下记录。`,
    }
  }

  const isReassign = order.delivererId !== null && order.delivererId !== delivererId

  await db.serviceOrder.update({
    where: { id: orderId },
    data: {
      delivererId,
      splitRatio: deliverer.splitRatio,
      status: order.status === 'paid' ? 'assigned' : order.status,
      assignedAt: order.assignedAt ?? new Date(),
      assignNote: note.trim() || null,
    },
  })

  // 学生付了钱就该知道谁在处理、什么时候能拿到
  await notifyServiceOrder(orderId, 'service_assigned')

  revalidatePath('/admin/dispatch')
  revalidatePath('/app/orders')
  return { ok: true as const, isReassign, delivererName: deliverer.name }
}

/**
 * 推进订单状态。
 *
 * ⚠️ 目标状态必须通过状态机校验。这里**不能**信任前端只会传合法值 ——
 *    server action 是公开端点,直接 POST 一个 confirmed 就能跳过交付进结算。
 */
export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  extra?: { deliveryNote?: string; deliveryUrl?: string },
) {
  await requireAdmin('operator')

  const order = await db.serviceOrder.findUnique({ where: { id: orderId } })
  if (!order) return { ok: false as const, error: '订单不存在' }

  if (!canTransition(order.status, status)) {
    return {
      ok: false as const,
      error: `不能从「${ORDER_STATUS_LABEL[order.status]}」直接变成「${ORDER_STATUS_LABEL[status]}」。`,
    }
  }

  if (status === 'delivering' && !order.delivererId) {
    return { ok: false as const, error: '还没派给任何交付人,不能标记交付中。' }
  }

  // 交付必须留痕 —— 出纠纷时这是唯一的依据
  if (status === 'delivered' && !extra?.deliveryNote?.trim()) {
    return {
      ok: false as const,
      error: '标记已交付前要填交付说明(交付了什么、什么时候、学生该去哪看)。',
    }
  }

  await db.serviceOrder.update({
    where: { id: orderId },
    data: {
      status,
      deliveredAt: status === 'delivered' ? new Date() : undefined,
      deliveryNote: extra?.deliveryNote?.trim() || undefined,
      deliveryUrl: extra?.deliveryUrl?.trim() || undefined,
      confirmedAt: status === 'confirmed' ? (order.confirmedAt ?? new Date()) : undefined,
      // 运营代确认要标出来 —— 结算争议时要能区分是学生点的还是我们点的
      autoConfirmed: status === 'confirmed' ? true : undefined,
    },
  })

  if (status === 'delivered') {
    await notifyServiceOrder(orderId, 'service_delivered')
  }

  revalidatePath('/admin/dispatch')
  revalidatePath('/app/orders')
  return { ok: true as const }
}

/**
 * 处理学生异议。
 *
 * ⚠️ 这个入口以前完全不存在。disputed 的订单被 48h 自动确认任务显式跳过
 *    (见 settlement.ts 的 runAutoConfirm),而运营又没有任何操作界面 ——
 *    结果是异议单永远卡在那里,交付人拿不到钱,学生也等不到答复。
 *
 * 三条出路都必须写明处理结论,不允许无记录地改状态。
 */
export async function resolveDispute(
  orderId: string,
  outcome: 'redo' | 'confirm' | 'refund',
  resolution: string,
) {
  const admin = await requireAdmin('operator')

  if (!resolution.trim()) {
    return { ok: false as const, error: '要写清处理结论 —— 这是之后对账和申诉的唯一依据。' }
  }

  const order = await db.serviceOrder.findUnique({ where: { id: orderId } })
  if (!order) return { ok: false as const, error: '订单不存在' }
  if (order.status !== 'disputed') {
    return { ok: false as const, error: '这个订单当前没有待处理的异议。' }
  }

  const target: OrderStatus =
    outcome === 'redo' ? 'delivering' : outcome === 'confirm' ? 'confirmed' : 'refunding'

  if (!canTransition('disputed', target)) {
    return { ok: false as const, error: '状态转移不合法' }
  }

  await db.serviceOrder.update({
    where: { id: orderId },
    data: {
      status: target,
      disputeResolution: resolution.trim().slice(0, 1000),
      disputeResolvedAt: new Date(),
      disputeResolvedBy: admin.adminId,
      // 重新交付时清掉交付时间,让 SLA 重新计
      deliveredAt: outcome === 'redo' ? null : undefined,
      confirmedAt: outcome === 'confirm' ? new Date() : undefined,
      autoConfirmed: outcome === 'confirm' ? true : undefined,
    },
  })

  revalidatePath('/admin/dispatch')
  revalidatePath('/app/orders')
  return {
    ok: true as const,
    note:
      outcome === 'refund'
        ? '已置为退款中。实际退款要到订单页发起,这里只改状态。'
        : outcome === 'confirm'
          ? '已确认完成,该单进入本月可结算范围。'
          : '已退回交付中,交付人需要重新交付。',
  }
}

/** ── 交付人管理 ───────────────────────────────────────── */

export interface DelivererInput {
  name: string
  role: string
  wxContact: string
  phone: string
  splitPercent: string
  note: string
  active: boolean
  /** ── 对外展示(官网老师栏)—— 只填能核实的内容 ── */
  showOnSite: boolean
  publicTitle: string
  education: string
  yearsExp: string
  specialties: string
  highlight: string
}

function parseSplit(input: string): number | null {
  const t = input.trim().replace('%', '')
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  // 输入的是百分比(如 60),存的是小数(0.6)
  if (n < 0 || n > 100) return null
  return n / 100
}

export async function saveDeliverer(id: string | null, input: DelivererInput) {
  await requireAdmin('operator')

  if (!input.name.trim()) return { ok: false as const, error: '姓名不能空。' }
  if (!input.role.trim()) return { ok: false as const, error: '角色不能空(顾问 / 文书编辑 / 学长学姐)。' }

  const splitRatio = parseSplit(input.splitPercent)
  if (splitRatio === null) {
    return { ok: false as const, error: '分成比例填 0-100 的数字,如 60 表示交付人拿 60%。' }
  }

  /**
   * 从业年限:留空 = 不展示;填了就必须是合理的数字。
   * 不做静默兜底 —— 这是给客户看的资质,写错比不写严重。
   */
  const yearsRaw = input.yearsExp.trim()
  let yearsExp: number | null = null
  if (yearsRaw) {
    const n = Number(yearsRaw)
    if (!Number.isFinite(n) || n < 0 || n > 60) {
      return { ok: false as const, error: '从业年限填 0-60 的数字,或留空不展示。' }
    }
    yearsExp = Math.round(n)
  }

  // 勾了「在官网展示」就至少得有个头衔,否则卡片上只有名字,没有信息量
  if (input.showOnSite && !input.publicTitle.trim() && !input.role.trim()) {
    return { ok: false as const, error: '要在官网展示,请先填对外头衔。' }
  }

  const data = {
    name: input.name.trim(),
    role: input.role.trim(),
    wxContact: input.wxContact.trim() || null,
    phone: input.phone.trim() || null,
    splitRatio,
    note: input.note.trim() || null,
    active: input.active,
    showOnSite: input.showOnSite,
    publicTitle: input.publicTitle.trim() || null,
    education: input.education.trim() || null,
    yearsExp,
    specialties: input.specialties.trim() || null,
    highlight: input.highlight.trim() || null,
  }

  if (id) await db.deliverer.update({ where: { id }, data })
  else await db.deliverer.create({ data })

  revalidatePath('/admin/deliverers')
  revalidatePath('/admin/dispatch')
  return { ok: true as const }
}

/**
 * 停用交付人。
 *
 * 不提供删除:交付人被 ServiceOrder 引用,删掉会让历史订单失去交付人信息,
 * 月结对账就查不到钱该付给谁了。停用即可 —— 停用后不再出现在派单下拉里,
 * 但历史订单照常显示。
 */
export async function setDelivererActive(id: string, active: boolean) {
  await requireAdmin('operator')

  if (!active) {
    const open = await db.serviceOrder.count({
      where: { delivererId: id, status: { in: ['assigned', 'delivering', 'disputed'] } },
    })
    if (open > 0) {
      return {
        ok: false as const,
        error: `他/她手上还有 ${open} 单没交付完。先把这些单改派或交付完,再停用。`,
      }
    }
  }

  await db.deliverer.update({ where: { id }, data: { active } })
  revalidatePath('/admin/deliverers')
  revalidatePath('/admin/dispatch')
  return { ok: true as const }
}
