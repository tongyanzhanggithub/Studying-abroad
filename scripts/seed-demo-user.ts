/**
 * 造一个可以直接体验全流程的学生账号(演示 / 联调用)。
 *
 *   PHONE=13800138000 npm run demo:seed
 *
 * 做四件事:
 *   1. 账号(手机号已存在就复用)
 *   2. 最长的那档订阅 —— 解锁 /app 下全部付费功能
 *   3. 一份可信的背景资料 —— 这样「重算」「文书合规检查」立刻能用
 *   4. 5 所选校 + 自动生成的材料清单
 *
 * ⚠️ 这是**演示数据**,不是真实用户。季票是直接写库的,没有对应支付记录,
 *    所以它在「我的订单」里不可退款、也不会进财务报表 —— 这是有意的,
 *    避免演示数据污染经营数字。
 *
 * ⚠️ 生产环境如果没接真实短信,还需要 ALLOW_MOCK_SMS=true 才能登录,
 *    且验证码只出现在服务端日志里(见 lib/auth/verification.ts)。
 */
import { db } from '@/lib/db'
import { regenerateMaterials } from '@/lib/materials/generate'
import { CURRENT_SEASON, TERMS_VERSION } from '@/lib/constants'
import { hashPassword, generatePassword, checkPasswordStrength } from '@/lib/auth/password'

/** 到期日 = 今天 + 套餐时长,和真实履约(lib/payment/fulfill.ts)算法一致 */
function expiryFrom(durationMonths: number): Date {
  const d = new Date()
  d.setMonth(d.getMonth() + durationMonths)
  return d
}

async function main() {
  const phone = (process.env.PHONE ?? '').trim()
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    console.error('✗ 需要一个合法手机号:PHONE=13800138000 npm run demo:seed')
    process.exit(1)
  }

  // 1) 账号
  const user = await db.user.upsert({
    where: { phone },
    create: {
      phone,
      name: '演示用户',
      agreedTermsAt: new Date(),
      agreedTermsVersion: TERMS_VERSION,
    },
    update: {},
  })

  /**
   * 1.5) 登录密码。
   * 没接短信的环境(演示 / 内网)靠它登录,不用去日志里翻验证码。
   * 不给 PASSWORD 就现场随机生成一个强密码,只打印一次。
   */
  const provided = process.env.PASSWORD
  if (provided) {
    const weak = checkPasswordStrength(provided)
    if (weak) {
      console.error(`✗ 密码太弱:${weak}`)
      process.exit(1)
    }
  }
  const password = provided ?? generatePassword()
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password), failedAttempts: 0, lockedUntil: null },
  })

  // 2) 订阅 —— 取时长最长的在售套餐,演示期间不用担心到期
  const plan = await db.plan.findFirst({ where: { active: true }, orderBy: { durationMonths: 'desc' } })
  if (!plan) {
    console.error('✗ 找不到在售套餐,先跑 npm run db:seed')
    process.exit(1)
  }
  const expiresAt = expiryFrom(plan.durationMonths)
  const active = await db.subscription.findFirst({
    where: { userId: user.id, status: 'active' },
  })
  if (active) {
    await db.subscription.update({
      where: { id: active.id },
      data: { planId: plan.id, expiresAt },
    })
  } else {
    await db.subscription.create({
      data: {
        userId: user.id,
        planId: plan.id,
        season: CURRENT_SEASON,
        status: 'active',
        paidAt: new Date(),
        expiresAt,
      },
    })
  }

  // 3) 背景资料 —— 不覆盖已有的(可能是真人自己填过的)
  const existingProfile = await db.profile.findUnique({ where: { userId: user.id } })
  if (!existingProfile?.undergradTier) {
    await db.profile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        undergradTier: 'c985_211',
        undergradMajor: 'Economics & Finance',
        gpa: 85,
        gpaScale: '100',
        languageType: 'ielts',
        languageScore: 7,
        // 故意设成 6.0:能演示「总分够但单项卡住」那类项目怎么被如实标出来
        languageMinBand: 6,
        targetRegions: ['UK', 'HK', 'SG'],
        targetDirection: 'finance',
      },
      update: {},
    })
  }

  // 4) 选校 + 材料清单
  const programs = await db.program.findMany({
    take: 5,
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (programs.length === 0) {
    console.warn('! 院校库是空的,跳过选校。先跑 npm run data:import')
  } else {
    const tiers = ['reach', 'reach', 'match', 'match', 'safe'] as const
    for (let i = 0; i < programs.length; i++) {
      const exists = await db.userSchoolChoice.findUnique({
        where: { userId_programId: { userId: user.id, programId: programs[i].id } },
      })
      if (exists) continue
      await db.userSchoolChoice.create({
        data: { userId: user.id, programId: programs[i].id, tierTag: tiers[i], sort: i },
      })
    }
    await regenerateMaterials(user.id)
  }

  const choices = await db.userSchoolChoice.count({ where: { userId: user.id } })
  const materials = await db.userMaterial.count({ where: { userId: user.id } })

  console.log('')
  console.log('─'.repeat(56))
  console.log('演示学生账号已就绪')
  console.log('─'.repeat(56))
  console.log(`  登录地址   /login  →  切到「密码登录」`)
  console.log(`  手机号     ${phone}`)
  console.log(`  密码       ${password}`)
  console.log(`  (另一种)  验证码登录需 ALLOW_MOCK_SMS=true,码在服务端日志里:`)
  console.log(`             journalctl -u compass -f | grep SMS:demo`)
  console.log(`  订阅       ${plan.name} · 至 ${expiresAt.toISOString().slice(0, 10)}`)
  console.log(`  选校单     ${choices} 所`)
  console.log(`  材料清单   ${materials} 项`)
  console.log('─'.repeat(56))
  console.log('')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
