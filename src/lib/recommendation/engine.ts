import 'server-only'
import { db } from '@/lib/db'
import { track } from '@/lib/analytics'
import { renderTemplate, daysUntil } from '@/lib/utils'
import { normalizeGpa } from '@/lib/assessment/engine'
import type {
  RecommendationCard,
  RecommendationContext,
  TriggerCondition,
  TriggerSpec,
} from './types'

/**
 * 情境化推荐引擎(PRD 4.7)。
 *
 * 商业模式的核心,但设计上必须**克制** —— PRD 原文:「克制是长期信任的一部分」。
 * 三条硬约束在 selectCard 里强制执行,不可绕过:
 *   1. 同一用户同一卡片,展示窗口期内最多 N 次(默认 7 天 2 次)
 *   2. 用户主动关闭后进入冷却期(默认 14 天)不再出现
 *   3. 每个页面同时最多 1 张卡
 */

// ── 上下文组装 ──────────────────────────────────────────

export async function buildContext(userId: string): Promise<RecommendationContext> {
  const [profile, choices, essays, serviceOrders] = await Promise.all([
    db.profile.findUnique({ where: { userId } }),
    db.userSchoolChoice.findMany({
      where: { userId },
      include: { program: { include: { school: true } } },
    }),
    db.essay.findMany({ where: { userId } }),
    db.serviceOrder.count({
      where: { userId, status: { in: ['paid', 'assigned', 'delivering', 'delivered', 'confirmed'] } },
    }),
  ])

  const tierCounts = { reach: 0, match: 0, safe: 0 }
  for (const c of choices) tierCounts[c.tierTag] += 1

  const deadlineDays = choices
    .map((c) => daysUntil(c.program.finalDeadline))
    .filter((d): d is number => d !== null && d >= 0)

  const interviewChoice = choices.find((c) => c.status === 'interview_invited')

  return {
    userId,
    gpa100:
      profile?.gpa != null && profile.gpaScale
        ? normalizeGpa(profile.gpa, profile.gpaScale === '4.0' ? '4.0' : '100')
        : null,
    isMajorSwitch: profile?.isMajorSwitch ?? false,
    tierCounts,
    maxEssayPolishRound: essays.reduce((max, e) => Math.max(max, e.polishRound), 0),
    hasUnfinishedEssay: essays.some((e) => e.status !== 'final'),
    daysToNearestDeadline: deadlineDays.length ? Math.min(...deadlineDays) : null,
    applicationStatuses: choices.map((c) => c.status),
    purchasedServiceCount: serviceOrders,
    interviewSchoolName:
      interviewChoice?.program.school.nameZh ?? interviewChoice?.program.school.nameEn ?? null,
  }
}

// ── 条件求值 ────────────────────────────────────────────

function evalCondition(cond: TriggerCondition, ctx: RecommendationContext): boolean {
  switch (cond.type) {
    case 'school_tier_count':
      return ctx.tierCounts[cond.tier] >= cond.gte
    case 'essay_polish_round':
      return ctx.maxEssayPolishRound >= cond.gte
    case 'deadline_approaching':
      if (ctx.daysToNearestDeadline === null) return false
      if (ctx.daysToNearestDeadline > cond.withinDays) return false
      return cond.essayNotFinal ? ctx.hasUnfinishedEssay : true
    case 'application_status':
      return ctx.applicationStatuses.includes(cond.status)
    case 'gpa_below':
      return ctx.gpa100 !== null && ctx.gpa100 < cond.value
    case 'major_switch':
      return ctx.isMajorSwitch
    case 'purchased_service_count':
      return ctx.purchasedServiceCount >= cond.gte
    default:
      return false
  }
}

function evalTrigger(spec: TriggerSpec, ctx: RecommendationContext): boolean {
  if (!spec.conditions?.length) return false
  return spec.op === 'all'
    ? spec.conditions.every((c) => evalCondition(c, ctx))
    : spec.conditions.some((c) => evalCondition(c, ctx))
}

/**
 * 解析文案里的 {n} 应该填什么。
 *
 * 取该规则**第一个能确定数量含义**的条件对应的值 —— 规则作者写
 * `{n} 所高风险冲刺` 时,{n} 必须是冲刺数;写 `已购 {n} 项服务` 时
 * 必须是已购数。用统一兜底链会串味。
 */
function resolveN(spec: TriggerSpec, ctx: RecommendationContext): number {
  for (const cond of spec.conditions ?? []) {
    switch (cond.type) {
      case 'school_tier_count':
        return ctx.tierCounts[cond.tier]
      case 'purchased_service_count':
        return ctx.purchasedServiceCount
      case 'essay_polish_round':
        return ctx.maxEssayPolishRound
      case 'deadline_approaching':
        return ctx.daysToNearestDeadline ?? 0
      default:
        continue
    }
  }
  return 0
}

// ── 频次约束 ────────────────────────────────────────────

async function passesFrequencyGuard(
  userId: string,
  rule: { id: string; maxShow: number; showWindowDays: number; cooldownDays: number },
): Promise<boolean> {
  const now = Date.now()

  // 关闭过 → 冷却期内不再出现
  const dismissed = await db.recommendationEvent.findFirst({
    where: { userId, ruleId: rule.id, action: 'dismissed' },
    orderBy: { createdAt: 'desc' },
  })
  if (dismissed) {
    const daysSince = (now - dismissed.createdAt.getTime()) / 86_400_000
    if (daysSince < rule.cooldownDays) return false
  }

  // 已成交 → 不再推同一个 SKU
  const purchased = await db.recommendationEvent.findFirst({
    where: { userId, ruleId: rule.id, action: 'purchased' },
  })
  if (purchased) return false

  // 窗口期内展示次数上限
  const windowStart = new Date(now - rule.showWindowDays * 86_400_000)
  const shownCount = await db.recommendationEvent.count({
    where: { userId, ruleId: rule.id, action: 'shown', createdAt: { gte: windowStart } },
  })
  return shownCount < rule.maxShow
}

// ── 选卡 ────────────────────────────────────────────────

/**
 * 为指定展示位挑选**至多一张**推荐卡。
 * 命中即记录 shown 埋点,供后台看漏斗(PRD 11.3:点击率 <2% 连续两周要重做文案)。
 */
export async function selectCard(
  userId: string,
  placement: string,
): Promise<RecommendationCard | null> {
  const rules = await db.recommendationRule.findMany({
    where: { active: true, placement },
    include: { sku: true },
    orderBy: { priority: 'desc' },
  })
  if (!rules.length) return null

  const ctx = await buildContext(userId)

  for (const rule of rules) {
    if (!evalTrigger(rule.trigger as unknown as TriggerSpec, ctx)) continue
    if (!(await passesFrequencyGuard(userId, rule))) continue

    const copy = renderTemplate(rule.copyTemplate, {
      // {n} 的含义随规则而变 —— 必须按规则自身的触发条件取值,
      // 不能用 `a || b || c` 兜底,否则「已购 N 项服务」会显示成冲刺院校数。
      n: resolveN(rule.trigger as unknown as TriggerSpec, ctx),
      // 「相似背景用户购买占比」—— 用真实成交数据,拿不到就不展示这个占位符
      pct: await similarUserPurchaseRate(rule.skuId),
      school: ctx.interviewSchoolName ?? '目标院校',
      days: ctx.daysToNearestDeadline ?? 0,
    })

    await db.recommendationEvent.create({
      data: { userId, ruleId: rule.id, action: 'shown' },
    })
    await track('rec_card_shown', { userId, properties: { ruleId: rule.id, placement } })

    return {
      ruleId: rule.id,
      ruleCode: rule.code,
      placement: rule.placement,
      copy,
      sku: {
        id: rule.sku.id,
        name: rule.sku.name,
        priceCents: rule.sku.priceCents,
        slaHours: rule.sku.slaHours,
      },
    }
  }

  return null
}

/**
 * 「{pct}% 相似背景用户在此环节购买了…」的真实占比。
 *
 * ⚠️ 合规:这个数字必须来自真实成交数据,绝不能写死一个好看的数。
 *    样本不足时返回 0,文案层负责在 pct 为 0 时隐藏该句。
 */
async function similarUserPurchaseRate(skuId: string): Promise<number> {
  const MIN_SAMPLE = 30
  const [totalSubscribers, buyers] = await Promise.all([
    db.subscription.count({ where: { status: 'active' } }),
    db.serviceOrder.count({
      where: { skuId, status: { in: ['paid', 'assigned', 'delivering', 'delivered', 'confirmed'] } },
    }),
  ])
  if (totalSubscribers < MIN_SAMPLE) return 0
  return Math.round((buyers / totalSubscribers) * 100)
}

// ── 交互回写 ────────────────────────────────────────────

export async function recordClick(userId: string, ruleId: string) {
  await db.recommendationEvent.create({ data: { userId, ruleId, action: 'clicked' } })
  await track('rec_card_clicked', { userId, properties: { ruleId } })
}

export async function recordDismiss(userId: string, ruleId: string) {
  await db.recommendationEvent.create({ data: { userId, ruleId, action: 'dismissed' } })
  await track('rec_card_dismissed', { userId, properties: { ruleId } })
}

export async function recordPurchase(userId: string, ruleId: string) {
  await db.recommendationEvent.create({ data: { userId, ruleId, action: 'purchased' } })
}
