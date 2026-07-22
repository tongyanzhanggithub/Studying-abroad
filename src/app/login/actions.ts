'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { createSession } from '@/lib/auth/session'
import {
  consumeVerificationCode,
  sendVerificationCode,
  isValidPhone,
  VerificationError,
} from '@/lib/auth/verification'
import { TERMS_VERSION } from '@/lib/constants'
import { hashPassword, verifyPassword, checkPasswordStrength } from '@/lib/auth/password'

/**
 * 取客户端真实 IP。
 *
 * ⚠️ 只认 X-Real-IP,不认客户端自带的 X-Forwarded-For。
 *    nginx 里 `proxy_set_header X-Real-IP $remote_addr` 会**覆盖**这个头,
 *    所以它是我们自己盖的、可信;而 XFF 客户端能随便伪造,
 *    用它限流等于攻击者换个头就绕过。
 *    没有 nginx 的场景(本地直连)拿不到就返回 null —— 限流那层会自动跳过。
 */
async function clientIp(): Promise<string | null> {
  const h = await headers()
  return h.get('x-real-ip') || null
}

export async function requestCode(phone: string) {
  try {
    const { devCode } = await sendVerificationCode(phone, await clientIp())
    return { ok: true as const, devCode }
  } catch (err) {
    if (err instanceof VerificationError) return { ok: false as const, error: err.message }
    console.error('[auth] 发送验证码失败', err)
    return { ok: false as const, error: '发送失败,请稍后再试' }
  }
}

/**
 * 验证码登录 / 注册合一。
 *
 * ⚠️ 合规(PRD 10.3):首次注册必须强制阅读确认隐私政策与用户协议,
 *    同意时间与版本号写入 users 表留痕。
 */
export async function loginWithCode(params: {
  phone: string
  code: string
  agreedTerms: boolean
}) {
  const { phone, code, agreedTerms } = params

  if (!isValidPhone(phone)) {
    return { ok: false as const, error: '手机号格式不正确' }
  }

  try {
    await consumeVerificationCode(phone, code)
  } catch (err) {
    if (err instanceof VerificationError) return { ok: false as const, error: err.message }
    throw err
  }

  const existing = await db.user.findUnique({ where: { phone } })

  if (!existing && !agreedTerms) {
    return { ok: false as const, error: '首次注册需要先阅读并同意用户协议与隐私政策' }
  }

  const user = existing
    ? existing
    : await db.user.create({
        data: {
          phone,
          agreedTermsAt: new Date(),
          agreedTermsVersion: TERMS_VERSION,
          profile: { create: {} },
        },
      })

  // 老用户遇到协议版本更新时补记同意
  if (existing && agreedTerms && existing.agreedTermsVersion !== TERMS_VERSION) {
    await db.user.update({
      where: { id: user.id },
      data: { agreedTermsAt: new Date(), agreedTermsVersion: TERMS_VERSION },
    })
  }

  /**
   * 把此前用同一手机号做过的免费评估线索关联到账号 —— 用于后台线索表的
   * 「已转化」标记。
   *
   * ⚠️ 只关联**最早的那一条**,而且必须是 updateMany + 单条 id。
   *    `Lead.convertedUserId` 是 @unique:一个用户只能占一条。
   *    早先这里是 `updateMany({ where: { phone, convertedUserId: null } })`,
   *    一个手机号只要做过 2 次以上评估,就会把多条设成同一个 userId,
   *    直接撞唯一约束 —— **登录整个失败**。
   *    会员可以存多份方案之后,这是必然会发生的,不是边缘情况。
   *
   *    「这个用户做过哪些评估」一律按手机号查,不依赖这个字段。
   */
  const firstLead = await db.lead.findFirst({
    where: { phone },
    orderBy: { createdAt: 'asc' },
    select: { id: true, convertedUserId: true },
  })
  if (firstLead && firstLead.convertedUserId === null) {
    const alreadyLinked = await db.lead.findFirst({
      where: { convertedUserId: user.id },
      select: { id: true },
    })
    if (!alreadyLinked) {
      await db.lead.update({
        where: { id: firstLead.id },
        data: { convertedUserId: user.id },
      })
    }
  }

  /**
   * 「先做评估、后注册」的用户:把之前评估填的背景补进档案,
   * 这样一登录「我的背景」就是满的,不用再填一遍。
   * 只在档案还空着时回填,不覆盖用户已经手填的。
   */
  const { backfillProfileFromLatestLead } = await import('@/lib/profile/from-assessment')
  await backfillProfileFromLatestLead(user.id, phone)

  await createSession({ userId: user.id, phone: user.phone })

  return { ok: true as const, isNewUser: !existing }
}

/** 连续失败几次开始锁 */
const MAX_PASSWORD_ATTEMPTS = 5
/** 锁多久(分钟)—— 15 分钟足够让自动化撞库不划算,又不至于把本人关太久 */
const LOCK_MINUTES = 15

/**
 * 密码登录(可选路径,主路径仍是验证码)。
 *
 * ⚠️ 两条防线,和后台登录同一套标准:
 *    1. scrypt 存储 —— 拖库之后不能被秒破
 *    2. 失败次数限流 —— 登录接口在公网上,不限流就是个可无限试的接口
 *
 * ⚠️ 「没设过密码」「手机号不存在」「密码错」返回**同一句话**。
 *    分开提示等于送给攻击者一个枚举「哪些手机号注册过」的接口。
 */
export async function loginWithPassword(params: {
  phone: string
  password: string
  next?: string
}) {
  const { phone, password } = params

  if (!isValidPhone(phone)) {
    return { ok: false as const, error: '手机号格式不正确' }
  }

  const GENERIC = '手机号或密码不正确'
  const user = await db.user.findUnique({ where: { phone } })

  if (!user || !user.passwordHash) {
    return { ok: false as const, error: GENERIC }
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000)
    return {
      ok: false as const,
      error: `登录失败次数过多,账号已临时锁定,请 ${mins} 分钟后再试(或改用验证码登录)。`,
    }
  }

  const { ok, needsUpgrade } = await verifyPassword(password, user.passwordHash)

  if (!ok) {
    const attempts = user.failedAttempts + 1
    await db.user.update({
      where: { id: user.id },
      data: {
        failedAttempts: attempts,
        lockedUntil:
          attempts >= MAX_PASSWORD_ATTEMPTS
            ? new Date(Date.now() + LOCK_MINUTES * 60_000)
            : null,
      },
    })
    if (attempts >= MAX_PASSWORD_ATTEMPTS) {
      return {
        ok: false as const,
        error: `登录失败次数过多,账号已锁定 ${LOCK_MINUTES} 分钟。可以改用验证码登录。`,
      }
    }
    const left = MAX_PASSWORD_ATTEMPTS - attempts
    return {
      ok: false as const,
      error: left <= 2 ? `${GENERIC}(再错 ${left} 次将锁定账号)` : GENERIC,
    }
  }

  // 成功:清计数,顺手把旧哈希升级到当前算法
  await db.user.update({
    where: { id: user.id },
    data: {
      failedAttempts: 0,
      lockedUntil: null,
      ...(needsUpgrade ? { passwordHash: await hashPassword(password) } : {}),
    },
  })

  await createSession({ userId: user.id, phone: user.phone })
  return { ok: true as const }
}

/**
 * 设置 / 修改自己的登录密码。需要已登录 —— 也就是说必须先通过验证码进来一次,
 * 密码只是之后的便捷入口,不能成为绕过手机号验证的注册途径。
 */
export async function setMyPassword(newPassword: string) {
  const { requireUser } = await import('@/lib/auth/session')
  const user = await requireUser()

  const weak = checkPasswordStrength(newPassword)
  if (weak) return { ok: false as const, error: weak }

  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(newPassword),
      failedAttempts: 0,
      lockedUntil: null,
    },
  })
  return { ok: true as const }
}

export async function logout() {
  const { destroySession } = await import('@/lib/auth/session')
  await destroySession()
  redirect('/')
}
