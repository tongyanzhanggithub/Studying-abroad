import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/lib/env'
import { ALLOWED_TRANSITIONS, canTransition } from '@/lib/services/dispatch'
import type { OrderStatus } from '@prisma/client'

/**
 * 派单状态机自检(仅开发环境)。
 *
 * 验的是这条:**不能跳过交付直接把订单标成 confirmed**。
 * `confirmed` 是月结分成的取数条件,能随意写这个状态就等于能凭空发钱。
 * server action 是公开端点,拦截必须在服务端,不能靠前端只渲染合法按钮。
 *
 * ⚠️ 生产环境直接 404。
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  if (request.headers.get('x-cron-secret') !== env.cronSecret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const checks: Array<{ name: string; pass: boolean; detail?: string }> = []
  const check = (name: string, pass: boolean, detail?: string) =>
    checks.push({ name, pass, detail })

  // ── 跳步必须被拒 ────────────────────────────────────────
  check(
    '刚付款不能直接标成已完成(否则跳过交付直接进结算)',
    !canTransition('paid', 'confirmed'),
  )
  check('刚付款不能直接标成已交付', !canTransition('paid', 'delivered'))
  check('已派单不能跳过交付中直接已交付', !canTransition('assigned', 'delivered'))
  check('未付款不能直接标成已付款', !canTransition('pending_payment', 'paid'))

  // ── 正常路径必须通 ──────────────────────────────────────
  check('付款 → 派单', canTransition('paid', 'assigned'))
  check('派单 → 交付中', canTransition('assigned', 'delivering'))
  check('交付中 → 已交付', canTransition('delivering', 'delivered'))
  check('已交付 → 已完成', canTransition('delivered', 'confirmed'))

  // ── 异议的三条出路都要通 ────────────────────────────────
  check('异议 → 退回重做', canTransition('disputed', 'delivering'))
  check('异议 → 协商后完成', canTransition('disputed', 'confirmed'))
  check('异议 → 转退款', canTransition('disputed', 'refunding'))
  check('交付中和已交付都能提异议',
    canTransition('delivering', 'disputed') && canTransition('delivered', 'disputed'))

  // ── 终态不可回退 ────────────────────────────────────────
  check(
    '已完成是终态(回退会让已结算的账对不上)',
    ALLOWED_TRANSITIONS.confirmed.length === 0,
  )
  check('已退款是终态', ALLOWED_TRANSITIONS.refunded.length === 0)
  check('已取消是终态', ALLOWED_TRANSITIONS.cancelled.length === 0)

  // ── 每个状态都要有定义,不能漏 ────────────────────────────
  const ALL: OrderStatus[] = [
    'pending_payment', 'paid', 'assigned', 'delivering', 'delivered',
    'disputed', 'confirmed', 'cancelled', 'refunding', 'refunded',
  ]
  check(
    '所有订单状态都在转移表里(漏一个就会在运行时变成「哪都去不了」)',
    ALL.every((s) => Array.isArray(ALLOWED_TRANSITIONS[s])),
    ALL.filter((s) => !Array.isArray(ALLOWED_TRANSITIONS[s])).join(',') || '无遗漏',
  )
  check(
    '转移表里没有指向未知状态的边',
    Object.values(ALLOWED_TRANSITIONS).every((tos) => tos.every((t) => ALL.includes(t))),
  )

  const passed = checks.filter((c) => c.pass).length
  return NextResponse.json(
    { ok: passed === checks.length, passed, total: checks.length, checks },
    { status: passed === checks.length ? 200 : 500 },
  )
}
