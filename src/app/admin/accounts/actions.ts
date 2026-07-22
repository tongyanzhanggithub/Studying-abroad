'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
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

  await db.adminUser.update({
    where: { id: me.adminId },
    data: { passwordHash: await hashPassword(next) },
  })
  return { ok: true as const }
}
