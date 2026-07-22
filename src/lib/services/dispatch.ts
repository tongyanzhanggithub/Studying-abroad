import type { OrderStatus } from '@prisma/client'

/**
 * ⚠️ 这个文件**不能**标 `server-only`:客户端组件要用 NEXT_ACTIONS 渲染按钮、
 *    用 ORDER_STATUS_LABEL 显示状态。标了会编译失败,而 tsc 查不出来 ——
 *    只有 Next 自己的编译器会报。
 *
 *    状态转移表本身不是机密,泄露给前端没有风险;真正的拦截在
 *    src/app/admin/dispatch/actions.ts 的服务端校验里。
 */

/**
 * 服务订单状态机。
 *
 * ⚠️ 早先后台的 `updateOrderStatus(orderId, status)` 接受任意目标状态,
 *    前端传什么就写什么。也就是说一个刚付款、还没派单的订单可以被直接
 *    标成 `confirmed` —— 而 `confirmed` 正是月结分成的取数条件
 *    (见 src/lib/services/settlement.ts)。等于跳过整个交付过程直接发钱。
 *
 *    状态机必须在服务端强制,不能靠「前端只显示合法按钮」。
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['cancelled'],
  // 支付后只能派单或退款,不能直接跳到交付
  paid: ['assigned', 'refunding'],
  assigned: ['delivering', 'refunding'],
  delivering: ['delivered', 'disputed', 'refunding'],
  delivered: ['confirmed', 'disputed'],
  // 异议单的三条出路:重新交付、协商后确认、退款
  disputed: ['delivering', 'confirmed', 'refunding'],
  // 已确认即进入可结算,不允许再回退 —— 回退会让已结算的账对不上
  confirmed: [],
  cancelled: [],
  refunding: ['refunded'],
  refunded: [],
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: '待付款',
  paid: '待派单',
  assigned: '已派单',
  delivering: '交付中',
  delivered: '已交付,待验收',
  disputed: '学生有异议',
  confirmed: '已完成',
  cancelled: '已取消',
  refunding: '退款中',
  refunded: '已退款',
}

/** 每个状态下运营能做的下一步(仅用于渲染按钮,真正的拦截在服务端) */
export const NEXT_ACTIONS: Partial<
  Record<OrderStatus, Array<{ to: OrderStatus; label: string }>>
> = {
  assigned: [{ to: 'delivering', label: '标记交付中' }],
  delivering: [{ to: 'delivered', label: '标记已交付' }],
  delivered: [{ to: 'confirmed', label: '代学生确认完成' }],
}
