'use server'

import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { createAdminSession, destroyAdminSession } from '@/lib/auth/session'
import { hashPassword, verifyPassword } from '@/lib/auth/password'

/**
 * 后台登录。
 *
 * ⚠️ 两条防线,缺一不可:
 *    1. 密码用 scrypt 存(见 lib/auth/password.ts)—— 拖库之后不能被秒破
 *    2. 失败次数限流 —— 后台登录页在公网上,不限流就是个可以无限试的接口
 */

/** 连续失败几次开始锁 */
const MAX_ATTEMPTS = 5
/** 锁多久(分钟)。锁死太久会把自己也关在外面,15 分钟足够让自动化撞库不划算 */
const LOCK_MINUTES = 15

export async function adminLogin(email: string, password: string) {
  const admin = await db.adminUser.findUnique({ where: { email: email.trim().toLowerCase() } })

  /**
   * ⚠️ 账号不存在和密码错误返回**同一句话**。
   *    分开提示等于送给攻击者一个枚举有效邮箱的接口。
   */
  const GENERIC = '邮箱或密码不正确'

  if (!admin || !admin.active) {
    return { ok: false as const, error: GENERIC }
  }

  if (admin.lockedUntil && admin.lockedUntil > new Date()) {
    const mins = Math.ceil((admin.lockedUntil.getTime() - Date.now()) / 60_000)
    return {
      ok: false as const,
      error: `登录失败次数过多,账号已临时锁定,请 ${mins} 分钟后再试。`,
    }
  }

  const { ok, needsUpgrade } = await verifyPassword(password, admin.passwordHash)

  if (!ok) {
    const attempts = admin.failedAttempts + 1
    await db.adminUser.update({
      where: { id: admin.id },
      data: {
        failedAttempts: attempts,
        lockedUntil:
          attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      },
    })
    if (attempts >= MAX_ATTEMPTS) {
      return {
        ok: false as const,
        error: `登录失败次数过多,账号已锁定 ${LOCK_MINUTES} 分钟。`,
      }
    }
    const left = MAX_ATTEMPTS - attempts
    return {
      ok: false as const,
      error: left <= 2 ? `${GENERIC}(再错 ${left} 次将锁定账号)` : GENERIC,
    }
  }

  // 登录成功:清计数,顺手把旧哈希升级到 scrypt
  await db.adminUser.update({
    where: { id: admin.id },
    data: {
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      ...(needsUpgrade ? { passwordHash: await hashPassword(password) } : {}),
    },
  })

  await createAdminSession({
    adminId: admin.id,
    role: admin.role,
    delivererId: admin.delivererId,
  })

  // 顾问不进运营后台,直接去自己的工作台
  return { ok: true as const, redirectTo: admin.role === 'advisor' ? '/advisor' : '/admin' }
}

export async function logoutAdmin() {
  await destroyAdminSession()
  redirect('/admin/login')
}
