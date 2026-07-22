import 'server-only'
import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import { env } from '@/lib/env'
import { db } from '@/lib/db'

const COOKIE_NAME = 'compass_session'
const ADMIN_COOKIE_NAME = 'compass_admin'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30

const secret = new TextEncoder().encode(env.authSecret)

export interface SessionPayload {
  userId: string
  phone: string
}

export interface AdminSessionPayload {
  adminId: string
  role: 'super_admin' | 'operator' | 'data_entry' | 'advisor'
  /** role = advisor 时带上他对应的交付人 id,用于过滤「只看自己的单」 */
  delivererId?: string | null
}

async function sign(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret)
}

async function verify<T>(token: string): Promise<T | null> {
  try {
    const { payload } = await jwtVerify(token, secret)
    return payload as T
  } catch {
    return null
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.isProd,
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  }
}

// ── 学生会话 ────────────────────────────────────────────

export async function createSession(payload: SessionPayload) {
  const token = await sign({ ...payload })
  ;(await cookies()).set(COOKIE_NAME, token, cookieOptions())
}

export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  if (!token) return null
  return verify<SessionPayload>(token)
}

export async function destroySession() {
  ;(await cookies()).delete(COOKIE_NAME)
}

/** 取当前登录用户;未登录返回 null */
export async function getCurrentUser() {
  const session = await getSession()
  if (!session) return null
  return db.user.findUnique({
    where: { id: session.userId },
    include: { profile: true },
  })
}

/** 取当前用户,未登录直接抛错 —— 用于 Server Action 入口 */
export async function requireUser() {
  const user = await getCurrentUser()
  if (!user) throw new Error('UNAUTHORIZED')
  return user
}

/**
 * 判断用户是否持有有效季票。
 * 免费功能(评估)不校验;/app 下所有付费功能必须校验。
 */
export async function getActiveSubscription(userId: string) {
  return db.subscription.findFirst({
    where: {
      userId,
      status: 'active',
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: { plan: true },
    orderBy: { paidAt: 'desc' },
  })
}

export async function requireSubscription() {
  const user = await requireUser()
  const sub = await getActiveSubscription(user.id)
  if (!sub) throw new Error('SUBSCRIPTION_REQUIRED')
  return { user, subscription: sub }
}

// ── 后台会话 ────────────────────────────────────────────

export async function createAdminSession(payload: AdminSessionPayload) {
  const token = await sign({ ...payload })
  ;(await cookies()).set(ADMIN_COOKIE_NAME, token, cookieOptions())
}

export async function getAdminSession(): Promise<AdminSessionPayload | null> {
  const token = (await cookies()).get(ADMIN_COOKIE_NAME)?.value
  if (!token) return null
  return verify<AdminSessionPayload>(token)
}

export async function destroyAdminSession() {
  ;(await cookies()).delete(ADMIN_COOKIE_NAME)
}

/**
 * 运营后台权限。
 *
 * ⚠️ advisor 排在 0,低于所有运营角色 —— 也就是说顾问**过不了任何一个
 *    requireAdmin 检查**,哪怕是最低的 data_entry。这是有意的:
 *    顾问是外部签约的交付人,不该看到院校库、价格、线索、其他人的订单。
 *    他走的是 requireAdvisor,那是另一条轴,不是这条阶梯的一级。
 */
const ROLE_RANK: Record<AdminSessionPayload['role'], number> = {
  advisor: 0,
  data_entry: 1,
  operator: 2,
  super_admin: 3,
}

export async function requireAdmin(minRole: AdminSessionPayload['role'] = 'data_entry') {
  const session = await getAdminSession()
  if (!session) throw new Error('UNAUTHORIZED')
  if (ROLE_RANK[session.role] < ROLE_RANK[minRole]) throw new Error('FORBIDDEN')
  return session
}

/**
 * 顾问端权限。
 *
 * super_admin 也放行 —— 出问题时要能进去看顾问看到的是什么,
 * 但必须显式带上 delivererId 才有单可看,否则列表是空的。
 */
export async function requireAdvisor() {
  const session = await getAdminSession()
  if (!session) throw new Error('UNAUTHORIZED')
  if (session.role !== 'advisor' && session.role !== 'super_admin') {
    throw new Error('FORBIDDEN')
  }
  return session
}
