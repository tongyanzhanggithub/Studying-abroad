/**
 * 造一组**专门用来验证截止日档次闸门**的数据。
 *
 *   PHONE=13800138000 npx tsx --tsconfig scripts/tsconfig.json scripts/seed-deadline-scenario.ts
 *
 * ── 为什么需要它 ──────────────────────────────────────
 *
 * 闸门(lib/programs/deadline.ts)的单元测试全绿,但单元测试证明不了
 * **页面上真的这么显示**。而这个 bug 的形状恰恰是「函数写对了,某一页忘了用」——
 * 那种错单元测试天生看不见。
 *
 * 所以造四个除了 deadlineAudience 之外**完全一样**的项目:
 * 同一所学校、同一个专业方向、同一个截止日(12 天后)、同样的语言要求。
 * 页面上它们唯一该有的差别,就是截止日那一句话。
 * 只要有一处漏了闸门,四行里就会出现自相矛盾的说法。
 *
 * 再加一份 60 天办理周期的材料 —— 12 天的截止日必然触发「赶不上」,
 * 用来验证材料中心和行动计划那两句催办有没有跟着闸门走。
 *
 * ⚠️ 只往本地开发库写。跑之前确认 DATABASE_URL 指向 localhost。
 */
import { db } from '@/lib/db'
import { regenerateMaterials } from '@/lib/materials/generate'
import { CURRENT_SEASON, TERMS_VERSION } from '@/lib/constants'
import type { DeadlineAudience } from '@prisma/client'

/**
 * 2 天 —— 刻意选在**红色紧急区**里。
 *
 * ⚠️ 一开始我用的是 12 天,四行的文案都对,于是差点收工。但 12 天在
 *    deadlineUrgency 里是 normal(灰),被闸门拦下的是 none(也是灰)——
 *    两者本来就都不刺眼,那个用例**根本没有区分能力**,
 *    证明不了「着色也过了闸门」。改成 2 天:能倒计时的会变红加粗,
 *    被拦下的必须仍然是灰的,这才验得出来。
 */
const DAYS_OUT = 2

function inDays(n: number): Date {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return d
}

/** 四个档次各一个项目,除 deadlineAudience 外其余字段完全相同 */
const CASES: Array<{ audience: DeadlineAudience; label: string; expect: string }> = [
  { audience: 'overseas', label: '需签证档', expect: `还有 ${DAYS_OUT} 天截止` },
  { audience: 'all', label: '官网不分档', expect: `还有 ${DAYS_OUT} 天截止` },
  { audience: 'home', label: '本地档', expect: '本档次不适用,以官网为准' },
  { audience: 'unspecified', label: '口径未标', expect: '截止日以官网为准' },
]

async function main() {
  const url = process.env.DATABASE_URL ?? ''
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    console.error('✗ DATABASE_URL 不是本地库,拒绝执行 —— 这个脚本只造测试数据')
    process.exit(1)
  }

  const phone = (process.env.PHONE ?? '13800138000').trim()

  const user = await db.user.upsert({
    where: { phone },
    create: {
      phone,
      name: '闸门测试用户',
      agreedTermsAt: new Date(),
      agreedTermsVersion: TERMS_VERSION,
    },
    update: {},
  })

  /**
   * 订阅:/app 下的页面要付费才进得去。
   *
   * ⚠️ Subscription.userId 不是唯一键(注销时要解绑保留,见 schema 注释),
   *    所以这里不能 upsert by userId —— 先查再决定。
   */
  const expiry = new Date()
  expiry.setMonth(expiry.getMonth() + 6)
  const plan = await db.plan.findFirst({ where: { active: true }, orderBy: { durationMonths: 'desc' } })
  if (!plan) {
    console.error('✗ 库里没有套餐,先跑 npm run db:seed')
    process.exit(1)
  }
  const existingSub = await db.subscription.findFirst({ where: { userId: user.id } })
  if (existingSub) {
    await db.subscription.update({
      where: { id: existingSub.id },
      data: { status: 'active', expiresAt: expiry },
    })
  } else {
    await db.subscription.create({
      data: {
        userId: user.id,
        planId: plan.id,
        status: 'active',
        expiresAt: expiry,
        season: CURRENT_SEASON,
      },
    })
  }

  const school = await db.school.upsert({
    where: { nameEn_region: { nameEn: 'Deadline Gate Test University', region: 'UK' } },
    create: {
      nameEn: 'Deadline Gate Test University',
      nameZh: '闸门测试大学',
      region: 'UK',
      qsRank: 1,
    },
    update: {},
  })

  /**
   * ⚠️ 地区闸门:未开放地区的项目在用户侧根本查不出来(lib/regions/gate.ts)。
   *    不打开 uk,这四个项目连列表都进不去,测了个寂寞。
   */
  await db.regionSetting.upsert({
    where: { region: 'UK' },
    create: { region: 'UK', isPublic: true, minPrograms: 1, minVerifiedRate: 0 },
    update: { isPublic: true, minPrograms: 1, minVerifiedRate: 0 },
  })

  console.log(`\n用户 ${phone}(${user.id})`)
  console.log(`截止日统一设为 ${DAYS_OUT} 天后:${inDays(DAYS_OUT).toISOString().slice(0, 10)}\n`)

  for (const c of CASES) {
    const nameEn = `MSc Gate Test (${c.audience})`
    const program = await db.program.upsert({
      where: { schoolId_nameEn: { schoolId: school.id, nameEn } },
      create: {
        schoolId: school.id,
        nameEn,
        nameZh: `闸门测试 · ${c.label}`,
        region: 'UK',
        direction: 'management',
        durationMonths: 12,
        finalDeadline: inDays(DAYS_OUT),
        deadlineAudience: c.audience,
        intakeTerm: '2027-09',
        active: true,
        isRolling: false,
        requirements: { ielts: { overall: 7, subscores: null } },
        confidence: 'verified',
        lastVerifiedAt: new Date(),
      },
      update: {
        finalDeadline: inDays(DAYS_OUT),
        deadlineAudience: c.audience,
        active: true,
        confidence: 'verified',
        lastVerifiedAt: new Date(),
      },
    })

    await db.userSchoolChoice.upsert({
      where: { userId_programId: { userId: user.id, programId: program.id } },
      create: { userId: user.id, programId: program.id, tierTag: 'match', status: 'not_started' },
      update: { status: 'not_started' },
    })

    console.log(`  ${c.audience.padEnd(12)} ${c.label.padEnd(6)} 期望文案:${c.expect}`)
  }

  await regenerateMaterials(user.id)
  const mats = await db.userMaterial.count({ where: { userId: user.id } })
  console.log(`
[用户A ${phone}] 四档齐全,已生成材料 ${mats} 项`)

  /**
   * ── 用户 B:选校单里**一个可用的截止日都没有** ──────────
   *
   * 用户 A 那组证明不了材料中心和行动计划:它们看的是「所有选校里最近的截止日」,
   * 而 A 的单子里有 overseas 档,那个数字**本来就该被采用** ——
   * 闸门有没有生效完全看不出来。
   *
   * B 的单子里只有 home 和 unspecified。此时正确行为是:
   *   · 不出现任何倒计时
   *   · 材料中心**不**说「赶不上」
   *   · 仪表盘出现「口径待核」那张卡,而不是「还没公布截止日」
   * 只要哪一处漏了闸门,B 就会看到「还有 2 天」。
   */
  const phoneB = '13800138001'
  const userB = await db.user.upsert({
    where: { phone: phoneB },
    create: {
      phone: phoneB,
      name: '闸门测试用户B',
      agreedTermsAt: new Date(),
      agreedTermsVersion: TERMS_VERSION,
    },
    update: {},
  })
  const subB = await db.subscription.findFirst({ where: { userId: userB.id } })
  if (subB) {
    await db.subscription.update({ where: { id: subB.id }, data: { status: 'active', expiresAt: expiry } })
  } else {
    await db.subscription.create({
      data: { userId: userB.id, planId: plan.id, status: 'active', expiresAt: expiry, season: CURRENT_SEASON },
    })
  }

  for (const audience of ['home', 'unspecified'] as const) {
    const prog = await db.program.findFirst({
      where: { schoolId: school.id, nameEn: `MSc Gate Test (${audience})` },
    })
    if (!prog) continue
    await db.userSchoolChoice.upsert({
      where: { userId_programId: { userId: userB.id, programId: prog.id } },
      create: { userId: userB.id, programId: prog.id, tierTag: 'match', status: 'not_started' },
      update: { status: 'not_started' },
    })
  }
  await regenerateMaterials(userB.id)
  console.log(`[用户B ${phoneB}] 只选了 home + unspecified 两个`)

  console.log(`
截止日 = ${DAYS_OUT} 天后,落在红色紧急区。验证要点:`)
  console.log('  用户A:四行里只有前两行出现「还有 2 天截止」,且只有那两行红色加粗')
  console.log('  用户B:不该出现任何倒计时;材料中心不说「赶不上」;仪表盘出现「口径待核」卡')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
