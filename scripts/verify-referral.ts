/**
 * 分享裂变闭环验证(PRD 9)
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/verify-referral.ts
 *
 * 直接调服务端逻辑走一遍:
 *   A 完成评估拿到 shareCode → B 通过 shareCode 完成评估
 *   → A 的 referralCount +1 → A 解锁 1 所附加院校
 *
 * 同时验证两条防滥用规则:自分享不计数、无效分享码不报错。
 */

import { PrismaClient } from '@prisma/client'
import { runAssessment, type AssessmentInput } from '../src/lib/assessment/engine'

const db = new PrismaClient()

const PHONE_A = '13900001001'
const PHONE_B = '13900001002'

const INPUT: AssessmentInput = {
  undergradTier: 'c985_211',
  undergradMajor: '商科',
  gpa: 85,
  gpaScale: '100',
  languageType: 'ielts',
  languageScore: 7,
  targetRegions: ['UK', 'HK', 'SG'],
  targetDirection: 'finance',
}

let step = 0
const ok = (m: string) => console.log(`  ${++step}. ✓ ${m}`)
const fail = (m: string): never => {
  console.error(`\n  ✗ ${m}`)
  process.exit(1)
}

/** 复刻 submitAssessment 里的归因逻辑(server action 无法从脚本直接调用) */
async function submit(phone: string, referralCode: string | null) {
  const result = await runAssessment(INPUT)

  const referrer = referralCode
    ? await db.lead.findUnique({ where: { shareCode: referralCode } })
    : null
  const valid = referrer && referrer.phone !== phone ? referrer : null

  const lead = await db.lead.create({
    data: {
      phone,
      assessPayload: INPUT as object,
      assessResult: result as unknown as object,
      referredById: valid?.id ?? null,
    },
  })

  if (valid) {
    await db.lead.update({
      where: { id: valid.id },
      data: { referralCount: { increment: 1 } },
    })
  }

  return { lead, result, attributed: !!valid }
}

async function cleanup() {
  await db.lead.deleteMany({ where: { phone: { in: [PHONE_A, PHONE_B] } } })
}

async function main() {
  console.log('\n分享裂变闭环验证\n' + '─'.repeat(46))
  await cleanup()

  // 1. A 完成评估
  const a = await submit(PHONE_A, null)
  if (!a.lead.shareCode) fail('线索没有生成 shareCode')
  ok(`A 完成评估,分享码 ${a.lead.shareCode.slice(0, 10)}…`)

  const poolSize = a.result.reachPool?.length ?? 0
  if (poolSize === 0) fail('冲刺档候补池为空,无法解锁 —— 检查 reachPool 逻辑')
  ok(`冲刺档候补池 ${poolSize} 所(解锁的是已算出但未展示的项目)`)

  // 展示的和候补池不能重叠,否则会「解锁」出一所已经看得见的学校
  const shownIds = new Set(a.result.reach.map((r) => r.programId))
  const dup = (a.result.reachPool ?? []).filter((p) => shownIds.has(p.programId))
  if (dup.length) fail(`候补池与已展示项目重叠 ${dup.length} 条`)
  ok('候补池与已展示项目无重叠')

  // 2. 自分享不计数
  const self = await submit(PHONE_A, a.lead.shareCode)
  if (self.attributed) fail('自己分享给自己竟然计入了裂变')
  ok('自分享未计数(同手机号)')
  await db.lead.delete({ where: { id: self.lead.id } })

  // 3. B 通过分享码完成评估
  const b = await submit(PHONE_B, a.lead.shareCode)
  if (!b.attributed) fail('B 通过分享码进来却没归因到 A')
  ok('B 通过分享码完成评估,已归因')

  const aAfter = await db.lead.findUniqueOrThrow({ where: { id: a.lead.id } })
  if (aAfter.referralCount !== 1) {
    fail(`A 的 referralCount 应为 1,实际 ${aAfter.referralCount}`)
  }
  ok(`A 的解锁进度 ${aAfter.referralCount}/1`)

  // 4. 解锁生效:结果页按 referralCount 取候补池
  const bonus = (a.result.reachPool ?? []).slice(0, aAfter.referralCount)
  if (bonus.length !== 1) fail('解锁数量不对')
  ok(`已解锁「${bonus[0].schoolName} ${bonus[0].programName}」`)

  // 5. 无效分享码不应报错,只是不归因
  const c = await submit('13900001003', 'not-a-real-code')
  if (c.attributed) fail('无效分享码竟然归因成功了')
  ok('无效分享码不报错,静默不归因')
  await db.lead.delete({ where: { id: c.lead.id } })

  // 6. 反向关系可查(运营要能看到谁带来了谁)
  const withRefs = await db.lead.findUniqueOrThrow({
    where: { id: a.lead.id },
    include: { referrals: true },
  })
  if (withRefs.referrals.length !== 1) fail('反向关联查不到被邀请人')
  ok('可追溯:A 带来了 1 位')

  console.log('─'.repeat(46))
  console.log(`\n全部 ${step} 项通过。\n`)

  await cleanup()
  console.log('测试数据已清理。')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
