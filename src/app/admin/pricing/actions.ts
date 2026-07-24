'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'

/**
 * 价格维护。
 *
 * ── 为什么改价是安全的 ────────────────────────────────
 * 下单时 `ServiceOrder.amountCents` / `Payment.amountCents` 会把当时的价格
 * **快照**下来,支付回调只跟快照对账(见 src/lib/payment/fulfill.ts 的金额校验)。
 * 所以在这里改价只影响之后的新订单,已下单、已支付、已结算的一律不受影响。
 *
 * ⚠️ 唯一要留意的:已经生成但还没付款的订单,用户付的仍是下单时那个价。
 *    这是对的 —— 页面上标什么价就该收什么价,不能在用户付款途中偷偷变价。
 *    页面会把这类订单数量显示出来,让运营心里有数。
 */

/** 只有 super_admin 能改价 —— 这直接决定收多少钱,门槛要高于日常运营 */
const PRICE_ROLE = 'super_admin' as const

/**
 * 元 → 分。
 *
 * ⚠️ 后台输入框收的是**元**,不是分。让运营填分迟早会出现少填两个零
 *    把 ¥1,200 打成 ¥12 的事故。这里统一在服务端换算并校验。
 */
function yuanToCents(input: string): number | null {
  const t = input.trim().replace(/[,,¥￥\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const cents = Math.round(Number(t) * 100)
  return Number.isSafeInteger(cents) ? cents : null
}

export interface SkuInput {
  name: string
  description: string
  priceYuan: string
  delivererRole: string
  deliveryForm: string
  slaHours: string
  active: boolean
  sort: string
}

export async function saveServiceSku(id: string, input: SkuInput) {
  const admin = await requireAdmin(PRICE_ROLE)

  const priceCents = yuanToCents(input.priceYuan)
  if (priceCents === null) {
    return { ok: false as const, error: '价格只能填数字,最多两位小数,如 1200 或 1200.50。' }
  }
  if (priceCents <= 0) {
    return { ok: false as const, error: '价格要大于 0。要下架请用「停售」开关,不要把价格设成 0。' }
  }
  if (!input.name.trim()) return { ok: false as const, error: '服务名不能空。' }

  const sla = Number(input.slaHours)
  if (!Number.isFinite(sla) || sla <= 0) {
    return { ok: false as const, error: '交付时限要填正整数小时。' }
  }

  const before = await db.serviceSku.findUnique({ where: { id } })
  if (!before) return { ok: false as const, error: '服务不存在' }

  await db.serviceSku.update({
    where: { id },
    data: {
      name: input.name.trim(),
      description: input.description.trim() || null,
      priceCents,
      delivererRole: input.delivererRole.trim(),
      deliveryForm: input.deliveryForm.trim(),
      slaHours: Math.round(sla),
      active: input.active,
      sort: Number(input.sort) || 0,
    },
  })

  revalidateServicePages()

  return {
    ok: true as const,
    changedPrice: before.priceCents !== priceCents,
    fromCents: before.priceCents,
    toCents: priceCents,
    by: admin.adminId,
  }
}

function revalidateServicePages() {
  revalidatePath('/admin/services')
  revalidatePath('/admin/pricing')
  revalidatePath('/pricing')
  revalidatePath('/app/services')
}

/**
 * 新增服务。
 *
 * ⚠️ 之前后台只能改 seed 出来的那五个,加不了新的 —— 也就是说想上一个
 *    「背景提升规划」或者「面签辅导」,得改代码重新部署。人工服务本来就是
 *    要按市场反馈不断调整的品类,这条路走不通等于这块业务被冻住了。
 */
export async function createServiceSku(input: SkuInput & { code: string }) {
  await requireAdmin(PRICE_ROLE)

  const priceCents = yuanToCents(input.priceYuan)
  if (priceCents === null || priceCents <= 0) {
    return { ok: false as const, error: '价格填元,要大于 0,如 1200。' }
  }
  if (!input.name.trim()) return { ok: false as const, error: '服务名不能空。' }

  const sla = Number(input.slaHours)
  if (!Number.isFinite(sla) || sla <= 0) {
    return { ok: false as const, error: '交付时限要填正整数小时。' }
  }

  /**
   * code 是给程序用的标识:推荐规则靠它关联服务、埋点靠它归因。
   * 让运营手填容易出现中文和空格,这里从名字生成,并保证唯一。
   */
  const base =
    input.code.trim().toLowerCase().replace(/[^a-z0-9_]/g, '') ||
    `svc_${Date.now().toString(36)}`

  let code = base
  for (let i = 2; await db.serviceSku.findUnique({ where: { code } }); i++) {
    code = `${base}_${i}`
    if (i > 50) return { ok: false as const, error: '生成标识失败,换个服务名试试。' }
  }

  const sku = await db.serviceSku.create({
    data: {
      code,
      name: input.name.trim(),
      description: input.description.trim() || null,
      priceCents,
      delivererRole: input.delivererRole.trim() || '待定',
      deliveryForm: input.deliveryForm.trim() || '待定',
      slaHours: Math.round(sla),
      // 新服务默认**不上架** —— 建完还要检查文案和交付人,
      // 直接出现在定价页上等于没审就卖
      active: false,
      sort: Number(input.sort) || 99,
    },
  })

  revalidateServicePages()
  return { ok: true as const, id: sku.id, code: sku.code }
}

/**
 * 删除服务。
 *
 * ⚠️ 有过订单的一律不给删:ServiceOrder 引用着它,删掉之后历史订单查不到
 *    买的是什么服务,月结对账和退款争议都没法处理。这种情况只能「停售」。
 */
export async function deleteServiceSku(id: string) {
  await requireAdmin(PRICE_ROLE)

  const [orders, rules] = await Promise.all([
    db.serviceOrder.count({ where: { skuId: id } }),
    db.recommendationRule.count({ where: { skuId: id } }),
  ])

  if (orders > 0) {
    return {
      ok: false as const,
      error: `这个服务已经有 ${orders} 笔订单,不能删除 —— 删了历史订单就查不到买的是什么了。改成「停售」即可,前台不再出现,老订单照常。`,
    }
  }

  /**
   * ⚠️ RecommendationRule 对 sku 是 onDelete: Cascade,删服务会**连带删掉**
   *    引用它的推荐规则。这个副作用不能悄悄发生 —— 运营可能只是想清理一个
   *    建错的服务,结果把调了很久的推荐配置一起删了。
   */
  await db.serviceSku.delete({ where: { id } })

  revalidateServicePages()
  return { ok: true as const, deletedRules: rules }
}

/** 删除前用来提示影响面 */
export async function getSkuUsage(id: string) {
  await requireAdmin(PRICE_ROLE)
  const [orders, rules] = await Promise.all([
    db.serviceOrder.count({ where: { skuId: id } }),
    db.recommendationRule.count({ where: { skuId: id } }),
  ])
  return { orders, rules }
}

export interface PlanInput {
  name: string
  priceYuan: string
  aiDailyQuota: string
  active: boolean
}

export async function savePlan(id: string, input: PlanInput) {
  await requireAdmin(PRICE_ROLE)

  const priceCents = yuanToCents(input.priceYuan)
  if (priceCents === null) return { ok: false as const, error: '价格格式不对。' }
  if (priceCents <= 0) return { ok: false as const, error: '价格要大于 0。' }

  const quota = Number(input.aiDailyQuota)
  if (!Number.isFinite(quota) || quota < 0) {
    return { ok: false as const, error: 'AI 每日次数要填非负整数。' }
  }

  const before = await db.plan.findUnique({ where: { id } })
  if (!before) return { ok: false as const, error: '套餐不存在' }

  await db.plan.update({
    where: { id },
    data: {
      name: input.name.trim(),
      priceCents,
      aiDailyQuota: Math.round(quota),
      active: input.active,
    },
  })

  revalidatePath('/admin/pricing')
  revalidatePath('/pricing')

  return {
    ok: true as const,
    changedPrice: before.priceCents !== priceCents,
    fromCents: before.priceCents,
    toCents: priceCents,
  }
}

/**
 * 删除套餐。
 *
 * ⚠️ 有人订阅过的一律不给删:Subscription 引用着 planId(且关系是 Restrict,
 *    数据库本身也会拦)。删了之后那些订阅查不到买的是哪个套餐,
 *    月结对账、退款、有效期判定全断。这种情况只能「停售」。
 *    退役旧档(如 basic/pro)时:没有真实订阅的可以直接删,有订阅的停售即可。
 */
export async function deletePlan(id: string) {
  await requireAdmin(PRICE_ROLE)

  const subs = await db.subscription.count({ where: { planId: id } })
  if (subs > 0) {
    return {
      ok: false as const,
      error: `这个套餐已经有 ${subs} 位用户订阅过,不能删除 —— 删了之后这些订阅记录会查不到买的是哪个套餐,月结对账、退款、有效期判定都会断。要下架的话把「在售」取消勾选即可,前台不再出现,老订阅照常。`,
    }
  }

  try {
    await db.plan.delete({ where: { id } })
  } catch {
    return {
      ok: false as const,
      error: '删除失败,这个套餐可能还被订阅记录引用。改用「停售」即可。',
    }
  }

  revalidatePath('/admin/pricing')
  revalidatePath('/pricing')
  return { ok: true as const }
}

/** 删除前用来提示影响面 */
export async function getPlanUsage(id: string) {
  await requireAdmin(PRICE_ROLE)
  const subscriptions = await db.subscription.count({ where: { planId: id } })
  return { subscriptions }
}
