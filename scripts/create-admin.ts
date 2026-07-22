/**
 * 创建 / 重置超级账号(后台 + 用户端)。
 *
 *   npm run admin:create
 *
 * 环境变量(都可省略):
 *   ADMIN_EMAIL     后台登录邮箱,默认 admin@compass.local
 *   ADMIN_PASSWORD  后台密码,不给就现场随机生成一个强密码
 *   ADMIN_NAME      显示名
 *   ADMIN_PHONE     用户端手机号 —— 给了就同时开一个带 Pro 季票的前台账号
 *
 * ⚠️ 密码只在终端打印**一次**,不写进任何文件。
 *    仓库里绝不能出现真实凭据 —— 一旦进了 git history 就很难彻底清除,
 *    而且这个仓库以后大概率会有第二个人接手。
 */

import { PrismaClient } from '@prisma/client'
import {
  hashPassword,
  checkPasswordStrength,
  generatePassword,
} from '../src/lib/auth/password'
import { CURRENT_SEASON, TERMS_VERSION } from '../src/lib/constants'

const db = new PrismaClient()

/** 季票有效期:开到申请季结束 */
function seasonExpiry(): Date {
  // 2027fall → 2027-10-31,和支付履约里的口径保持一致
  const year = Number(CURRENT_SEASON.slice(0, 4))
  return new Date(Date.UTC(year, 9, 31, 23, 59, 59))
}

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? 'admin@compass.local').trim().toLowerCase()
  const name = process.env.ADMIN_NAME ?? '超级管理员'
  const phone = process.env.ADMIN_PHONE?.trim()

  const provided = process.env.ADMIN_PASSWORD
  const password = provided ?? generatePassword()

  if (provided) {
    const problem = checkPasswordStrength(provided)
    if (problem) {
      console.error(`✗ 密码不合格:${problem}`)
      process.exit(1)
    }
  }

  const passwordHash = await hashPassword(password)

  const existing = await db.adminUser.findUnique({ where: { email } })

  const admin = await db.adminUser.upsert({
    where: { email },
    create: { email, name, passwordHash, role: 'super_admin' },
    update: {
      name,
      passwordHash,
      role: 'super_admin',
      active: true,
      // 重置密码时把锁一并解开 —— 被自己锁在外面时这就是唯一的出路
      failedAttempts: 0,
      lockedUntil: null,
    },
  })

  console.log('')
  console.log('─'.repeat(58))
  console.log(existing ? '已重置后台超级账号' : '已创建后台超级账号')
  console.log('─'.repeat(58))
  console.log(`  后台地址   /admin/login`)
  console.log(`  邮箱       ${admin.email}`)
  console.log(`  密码       ${password}`)
  console.log(`  角色       super_admin(所有页面全权限)`)

  // ── 用户端账号 ────────────────────────────────────────
  if (phone) {
    if (!/^\d{11}$/.test(phone)) {
      console.error('\n✗ ADMIN_PHONE 要是 11 位手机号,用户端账号没有创建。')
      process.exit(1)
    }

    const user = await db.user.upsert({
      where: { phone },
      create: {
        phone,
        name,
        agreedTermsAt: new Date(),
        agreedTermsVersion: TERMS_VERSION,
      },
      update: {},
    })

    // 给 Pro 季票,这样前台每一个付费功能都看得到
    const pro = await db.plan.findUnique({ where: { code: 'pro' } })
    if (!pro) {
      console.error('\n✗ 找不到 Pro 套餐,先跑 npm run db:seed。用户端季票没有开通。')
    } else {
      const active = await db.subscription.findFirst({
        where: { userId: user.id, status: 'active' },
      })
      if (active) {
        await db.subscription.update({
          where: { id: active.id },
          data: { planId: pro.id, expiresAt: seasonExpiry() },
        })
      } else {
        await db.subscription.create({
          data: {
            userId: user.id,
            planId: pro.id,
            season: CURRENT_SEASON,
            status: 'active',
            paidAt: new Date(),
            expiresAt: seasonExpiry(),
          },
        })
      }

      console.log('')
      console.log(`  用户端     /login`)
      console.log(`  手机号     ${phone}`)
      console.log(`  验证码     开发环境直接显示在登录页;生产走真实短信`)
      console.log(`  季票       Pro · 有效期至 ${seasonExpiry().toISOString().slice(0, 10)}`)
      console.log(`             ⚠️ 这张季票是直接写库的,没有对应支付记录,`)
      console.log(`                所以在「我的订单」里不可退款,也不会进财务报表。`)
    }
  } else {
    console.log('')
    console.log('  提示:加 ADMIN_PHONE=138xxxxxxxx 可以同时开一个带 Pro 季票的前台账号。')
  }

  console.log('─'.repeat(58))
  console.log('密码只显示这一次,现在就存进密码管理器。')
  console.log('它不会被写进任何文件 —— 忘了就重跑这个脚本重置。')
  console.log('─'.repeat(58))
  console.log('')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
