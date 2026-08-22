'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin, createAdminSession } from '@/lib/auth/session'
import {
  hashPassword,
  checkPasswordStrength,
  generatePassword,
} from '@/lib/auth/password'
import type { AdminRole } from '@prisma/client'

/**
 * 员工账号管理。
 *
 * ⚠️ 只有 super_admin 能进 —— 能建账号就能给自己提权,这是权限体系的根。
 */
const ROOT = 'super_admin' as const

export interface AccountInput {
  email: string
  name: string
  role: AdminRole
  /** role = advisor 时必填 */
  delivererId: string
}

function normalizeEmail(v: string) {
  return v.trim().toLowerCase()
}

async function validate(input: AccountInput, excludeId?: string) {
  const email = normalizeEmail(input.email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '邮箱格式不对。'
  if (!input.name.trim()) return '姓名不能空。'

  const dup = await db.adminUser.findUnique({ where: { email } })
  if (dup && dup.id !== excludeId) return '这个邮箱已经有账号了。'

  if (input.role === 'advisor') {
    if (!input.delivererId) return '顾问账号必须关联一个交付人 —— 不然他登录后看不到任何单。'
    const d = await db.deliverer.findUnique({
      where: { id: input.delivererId },
      include: { account: true },
    })
    if (!d) return '交付人不存在。'
    if (d.account && d.account.id !== excludeId) {
      return `${d.name} 已经有账号了(${d.account.email})。一个交付人只能绑一个账号。`
    }
  }
  return null
}

export async function createAccount(input: AccountInput) {
  await requireAdmin(ROOT)

  const problem = await validate(input)
  if (problem) return { ok: false as const, error: problem }

  const password = generatePassword()
  const account = await db.adminUser.create({
    data: {
      email: normalizeEmail(input.email),
      name: input.name.trim(),
      role: input.role,
      passwordHash: await hashPassword(password),
      delivererId: input.role === 'advisor' ? input.delivererId : null,
    },
  })

  revalidatePath('/admin/accounts')
  /**
   * 密码只在这一次返回。不落库明文、不发邮件(邮件服务还没接)——
   * 由管理员当面或通过安全渠道转交,并让对方尽快自行修改。
   */
  return { ok: true as const, email: account.email, password }
}

export async function updateAccount(id: string, input: AccountInput) {
  const me = await requireAdmin(ROOT)

  const target = await db.adminUser.findUnique({ where: { id } })
  if (!target) return { ok: false as const, error: '账号不存在' }

  const problem = await validate(input, id)
  if (problem) return { ok: false as const, error: problem }

  /**
   * ⚠️ 不允许把自己降级。
   *    系统里如果一个 super_admin 都不剩,就没人能再建账号、改权限、
   *    改价格 —— 只能去数据库里手动改。这个死锁必须在这里挡住。
   */
  if (id === me.adminId && input.role !== 'super_admin') {
    return { ok: false as const, error: '不能把自己降级 —— 会把自己锁在权限体系外面。' }
  }

  await db.adminUser.update({
    where: { id },
    data: {
      email: normalizeEmail(input.email),
      name: input.name.trim(),
      role: input.role,
      delivererId: input.role === 'advisor' ? input.delivererId : null,
    },
  })

  revalidatePath('/admin/accounts')
  return { ok: true as const }
}

export async function resetAccountPassword(id: string) {
  await requireAdmin(ROOT)

  const password = generatePassword()
  await db.adminUser.update({
    where: { id },
    data: {
      passwordHash: await hashPassword(password),
      // 重置密码顺带解锁 —— 被自己锁在外面时这就是出路
      failedAttempts: 0,
      lockedUntil: null,
      /**
       * ⚠️ 这里 +1 之后**刻意不重新签会话** —— 和改自己密码正相反。
       *    超管重置别人的密码,常见场景就是「这个人的号可能出问题了」
       *    或者「他离职了/换人了」。把对方所有在线 token 踢掉正是目的。
       */
      sessionVersion: { increment: 1 },
    },
  })

  revalidatePath('/admin/accounts')
  return { ok: true as const, password }
}

export async function setAccountActive(id: string, active: boolean) {
  const me = await requireAdmin(ROOT)

  if (id === me.adminId && !active) {
    return { ok: false as const, error: '不能停用自己。' }
  }

  if (!active) {
    // 停用最后一个 super_admin 会让系统失去管理员
    const target = await db.adminUser.findUnique({ where: { id } })
    if (target?.role === 'super_admin') {
      const others = await db.adminUser.count({
        where: { role: 'super_admin', active: true, id: { not: id } },
      })
      if (others === 0) {
        return { ok: false as const, error: '这是最后一个启用中的超级管理员,停用后没人能管理系统了。' }
      }
    }
  }

  await db.adminUser.update({ where: { id }, data: { active } })
  revalidatePath('/admin/accounts')
  return { ok: true as const }
}

/** 修改自己的密码 —— 所有角色都能用,包括顾问 */
export async function changeOwnPassword(current: string, next: string) {
  const me = await requireAdmin('advisor')

  const { verifyPassword } = await import('@/lib/auth/password')
  const account = await db.adminUser.findUnique({ where: { id: me.adminId } })
  if (!account) return { ok: false as const, error: '账号不存在' }

  const { ok } = await verifyPassword(current, account.passwordHash)
  if (!ok) return { ok: false as const, error: '当前密码不正确。' }

  const problem = checkPasswordStrength(next)
  if (problem) return { ok: false as const, error: problem }

  /**
   * ⚠️ sessionVersion +1 —— 这才是「改密码」这个动作的实际意义。
   *
   *    后台会话是 30 天有效的 JWT、服务端不存 session,只改 passwordHash
   *    对已经签发出去的 token 毫无影响:号被盗、改了密码,攻击者手里
   *    那个 token 照样能再用 30 天。而后台 token 的权限比学生端大得多。
   *    版本号一加,所有旧 token(包括他自己其它设备上的)立刻失效。
   */
  const updated = await db.adminUser.update({
    where: { id: me.adminId },
    data: {
      passwordHash: await hashPassword(next),
      sessionVersion: { increment: 1 },
    },
  })

  /**
   * ⚠️ 当前这台设备用新版本号重新签一次,否则**他自己也会被踢出去**。
   *
   *    他刚刚用旧密码验证过身份,没有理由把他也踢掉 —— 那只会让人
   *    每改一次密码就得重登一次,进而觉得这个功能很烦。
   *    要踢的是别的设备。学生端 setMyPassword 也是这么做的。
   */
  await createAdminSession({
    adminId: updated.id,
    role: updated.role,
    delivererId: updated.delivererId,
    sv: updated.sessionVersion,
  })

  return { ok: true as const }
}
