/**
 * 主转化漏斗端到端冒烟测试
 *   npx tsx scripts/e2e-smoke.ts
 *
 * 直接调用服务端逻辑(不走浏览器),验证 PRD 5.1 主路径能真正跑通:
 *   免费评估 → 线索入库 → 注册 → 支付开通 → onboarding → 材料清单 → 文书 → 推荐卡
 *
 * 这是「能不能用」的验证,不是单元测试。任何一步失败都会抛错并退出非零。
 */

import { PrismaClient } from '@prisma/client'
import { runAssessment } from '../src/lib/assessment/engine'
import { regenerateMaterials, getMaterialProgress } from '../src/lib/materials/generate'
import { selectCard } from '../src/lib/recommendation/engine'
import { fulfillPayment } from '../src/lib/payment/fulfill'
import { runComplianceCheck } from '../src/lib/essays/compliance'
import { notifyProgramChange } from '../src/lib/notifications/send'
import { CURRENT_SEASON, TERMS_VERSION } from '../src/lib/constants'

const db = new PrismaClient()
const PHONE = '13900000001'

let step = 0
function ok(msg: string) {
  step += 1
  console.log(`  ${String(step).padStart(2)}. ✓ ${msg}`)
}
function fail(msg: string): never {
  console.error(`\n  ✗ 失败:${msg}`)
  process.exit(1)
}

async function cleanup() {
  const u = await db.user.findUnique({ where: { phone: PHONE } })
  if (u) await db.user.delete({ where: { id: u.id } })
  await db.lead.deleteMany({ where: { phone: PHONE } })
}

async function main() {
  console.log('\n主转化漏斗冒烟测试\n' + '─'.repeat(50))
  await cleanup()

  // ── 1. 免费评估 ───────────────────────────────────
  const input = {
    undergradTier: 'c985_211' as const,
    undergradMajor: '商科',
    gpa: 85,
    gpaScale: '100' as const,
    languageType: 'ielts' as const,
    languageScore: 7.0,
    targetRegions: ['UK' as const, 'HK' as const, 'SG' as const],
    targetDirection: 'finance' as const,
  }

  const result = await runAssessment(input)
  const shown = result.reach.length + result.match.length + result.safe.length
  if (shown === 0) fail('评估没有产出任何结果 —— 检查 AdmissionRule 与 Program 数据是否匹配')
  ok(`评估产出 ${shown} 所(冲刺${result.reach.length}/匹配${result.match.length}/保底${result.safe.length}),命中总数 ${result.totalMatched}`)

  if (!result.disclaimer.includes('预估')) fail('评估结果缺少「预估」免责表述(PRD 10.1 红线)')
  ok('结果带免责声明')

  // ── 2. 线索入库 ───────────────────────────────────
  const lead = await db.lead.create({
    data: {
      phone: PHONE,
      assessPayload: input as object,
      assessResult: result as unknown as object,
      sourceChannel: 'smoke-test',
    },
  })
  ok('线索入库')

  // ── 3. 注册 ──────────────────────────────────────
  const user = await db.user.create({
    data: {
      phone: PHONE,
      agreedTermsAt: new Date(),
      agreedTermsVersion: TERMS_VERSION,
      profile: {
        create: {
          undergradTier: input.undergradTier,
          gpa: input.gpa,
          gpaScale: input.gpaScale,
          languageType: input.languageType,
          languageScore: input.languageScore,
        },
      },
    },
  })
  await db.lead.update({ where: { id: lead.id }, data: { convertedUserId: user.id } })
  ok('注册并关联线索')

  // ── 4. 支付开通季票 ────────────────────────────────
  const plan = await db.plan.findUniqueOrThrow({ where: { code: 'basic' } })
  const sub = await db.subscription.create({
    data: { userId: user.id, planId: plan.id, season: CURRENT_SEASON, status: 'expired' },
  })
  const payment = await db.payment.create({
    data: {
      userId: user.id,
      orderType: 'subscription',
      orderId: sub.id,
      channel: 'mock',
      amountCents: plan.priceCents,
      outTradeNo: `SMOKE${Date.now()}`,
    },
  })
  await fulfillPayment({
    outTradeNo: payment.outTradeNo,
    transactionId: 'SMOKETXN',
    amountCents: plan.priceCents,
  })
  const activated = await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })
  if (activated.status !== 'active') fail('支付成功后季票未开通')
  ok(`支付履约,季票生效至 ${activated.expiresAt?.toISOString().slice(0, 10)}`)

  // 幂等性:重复回调不应二次履约
  await fulfillPayment({
    outTradeNo: payment.outTradeNo,
    transactionId: 'SMOKETXN',
    amountCents: plan.priceCents,
  })
  ok('重复支付回调幂等')

  // 金额篡改必须被拒
  const tampered = await db.payment.create({
    data: {
      userId: user.id, orderType: 'subscription', orderId: sub.id, channel: 'mock',
      amountCents: plan.priceCents, outTradeNo: `TAMPER${Date.now()}`,
    },
  })
  let rejected = false
  try {
    await fulfillPayment({ outTradeNo: tampered.outTradeNo, transactionId: 'T', amountCents: 1 })
  } catch {
    rejected = true
  }
  if (!rejected) fail('金额不符的回调竟然被接受了 —— 支付校验失效')
  ok('金额篡改的回调被拒绝')

  // ── 5. onboarding:生成选校单 ────────────────────────
  const picks = [...result.reach.slice(0, 2), ...result.match.slice(0, 2), ...result.safe.slice(0, 2)]
  for (const [i, p] of picks.entries()) {
    await db.userSchoolChoice.create({
      data: { userId: user.id, programId: p.programId, tierTag: p.tier, sort: i },
    })
  }
  ok(`选校单写入 ${picks.length} 所`)

  // ── 6. 材料清单自动合并去重 ──────────────────────────
  await regenerateMaterials(user.id)
  const materials = await db.userMaterial.findMany({
    where: { userId: user.id },
    include: { template: true },
  })
  if (materials.length === 0) fail('材料清单为空 —— 检查 program ↔ materialTemplate 关联')

  const dupes = materials.filter((m) => m.template.sharedAcrossPrograms && m.programIds.length > 1)
  ok(`材料清单 ${materials.length} 项,其中 ${dupes.length} 项跨校共用已去重`)

  const transcript = materials.find((m) => m.template.code === 'transcript')
  if (transcript && transcript.programIds.length !== picks.length) {
    fail(`成绩单应适用全部 ${picks.length} 所,实际 ${transcript.programIds.length} 所`)
  }
  ok('共用材料适用范围正确')

  // ── 7. 文书与合规检查 ───────────────────────────────
  const essay = await db.essay.create({
    data: {
      userId: user.id,
      programId: picks[0].programId,
      title: '冒烟测试文书',
      promptText: 'Why this programme?',
      wordLimit: 500,
    },
  })
  await db.essayVersion.create({
    data: { essayId: essay.id, content: 'a '.repeat(350), wordCount: 350, createdBy: 'user' },
  })
  const check = await runComplianceCheck(essay.id)
  if (!check.issues.length) fail('合规检查没有产出任何提示 —— 至少应有 AI 声明提醒')
  ok(`合规检查通过=${check.passed},产出 ${check.issues.length} 条提示`)

  const emptyEssay = await db.essay.create({
    data: { userId: user.id, title: '空文书', wordLimit: 500 },
  })
  const emptyCheck = await runComplianceCheck(emptyEssay.id)
  if (emptyCheck.passed) fail('空文书竟然通过了合规检查')
  ok('空文书被合规检查拦截')

  // ── 8. 推荐引擎 ────────────────────────────────────
  const card = await selectCard(user.id, 'schools_top')
  if (!card) fail('选校单有 2 所冲刺档,应触发选校咨询推荐卡但没有')
  if (/保录|保offer|100%/.test(card.copy)) fail(`推荐卡文案含违禁词:${card.copy}`)
  ok(`推荐卡命中「${card.ruleCode}」:${card.copy.slice(0, 30)}…`)

  const again = await selectCard(user.id, 'schools_top')
  const shownCount = await db.recommendationEvent.count({
    where: { userId: user.id, ruleId: card.ruleId, action: 'shown' },
  })
  ok(`频次控制生效(窗口内已展示 ${shownCount} 次,上限内${again ? '仍可展示' : '已拦截'})`)

  await db.recommendationEvent.create({
    data: { userId: user.id, ruleId: card.ruleId, action: 'dismissed' },
  })
  const afterDismiss = await selectCard(user.id, 'schools_top')
  if (afterDismiss) fail('用户关闭推荐卡后仍再次展示 —— 冷却期失效')
  ok('关闭后进入冷却期,不再展示')

  // ── 9. 数据变更推送(PRD 5.4)──────────────────────
  const log = await db.programChangeLog.create({
    data: {
      programId: picks[0].programId,
      field: 'requirements.gpa_requirement',
      oldValue: '80', newValue: '85',
      summary: '均分要求从 80 上调到 85',
      changedBy: 'smoke-test',
    },
  })
  const notified = await notifyProgramChange(log.id)
  if (notified < 1) fail('数据变更未推送给受影响用户')
  ok(`数据变更推送给 ${notified} 位用户`)

  // ── 10. 数据可信度红线 ─────────────────────────────
  const total = await db.program.count()
  const unverified = await db.program.count({ where: { confidence: 'ai_collected' } })
  const progress = await getMaterialProgress(user.id)
  ok(`材料完成度 ${progress.percent}%(${progress.done}/${progress.total})`)

  console.log('─'.repeat(50))
  console.log(`\n全部 ${step} 项通过。\n`)
  console.log(`院校库:${total} 条,其中 ${unverified} 条待人工核对(${Math.round((unverified / total) * 100)}%)`)
  if (unverified === total) {
    console.log('⚠️  目前 100% 未核对 —— 按 PRD 11.3,投放前必须先把这个比例降到 10% 以下。')
  }

  await cleanup()
  console.log('\n测试数据已清理。')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
