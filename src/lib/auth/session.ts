import 'server-only'
import { cache } from 'react'
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
  /**
   * 签发时的会话版本号。
   *
   * ⚠️ 老 token 里没有这个字段,按 0 处理 —— 上线时不会把所有人踢下线。
   *    但只要有人改过一次密码(版本变成 1),他那些老 token 就 0 !== 1 立即失效,
   *    这正是我们要的。
   */
  sv?: number
}

export interface AdminSessionPayload {
  adminId: string
  role: 'super_admin' | 'operator' | 'data_entry' | 'advisor'
  /** role = advisor 时带上他对应的交付人 id,用于过滤「只看自己的单」 */
  delivererId?: string | null
  /**
   * 会话版本号,和 AdminUser.sessionVersion 比对。
   *
   * ⚠️ 可选是为了兼容**这个字段上线之前签发的旧 token** ——
   *    它们没有 sv,而 DB 里默认是 0,下面用 `?? 0` 让两边对上,
   *    所以这次改动不会把所有在线的后台用户一次性踢下线。
   */
  sv?: number
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

/**
 * cookie 的 Secure 标志必须跟着**实际协议**走,不能只看 NODE_ENV。
 *
 * ⚠️ 这里踩过一次:原来写的是 `secure: env.isProd`。生产环境但还没配 HTTPS
 *    (刚上云、只有 IP 没有域名)时,浏览器会**直接丢弃**带 Secure 的 cookie。
 *    表现极具迷惑性:密码验证通过、服务端也 set 了 cookie,但浏览器没存下,
 *    下一个请求依旧是未登录 → 布局把人弹回登录页 → 用户看到的是
 *    「点登录没有任何反应」,连错误提示都没有(因为服务端认为登录成功了)。
 *
 * 按 NEXT_PUBLIC_SITE_URL 的协议判断:https 才加 Secure。
 * 配上域名和证书后自动变回 Secure,不用记得回来改。
 */
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.siteUrl.startsWith('https://'),
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  }
}

// ── 学生会话 ────────────────────────────────────────────

export async function createSession(payload: SessionPayload) {
  const token = await sign({ ...payload })
  ;(await cookies()).set(COOKIE_NAME, token, cookieOptions())
}

/**
 * ⚠️ 用 React cache() 包一层:同一次请求内多处调用只算一次。
 *
 *    /app 下的 layout 会取一次用户,每个 page 又各自 requireUser() 再取一次,
 *    结果每个已登录页面至少重复查两遍 user(含 profile)、重复验签两次 ——
 *    这是所有鉴权页面的固定开销,对小规格 RDS 是纯浪费。
 *    cache() 按参数在**单次请求**内去重,跨请求不缓存,不会串号。
 */
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  if (!token) return null
  return verify<SessionPayload>(token)
})

export async function destroySession() {
  ;(await cookies()).delete(COOKIE_NAME)
}

/** 取当前登录用户;未登录返回 null。单次请求内去重(见 getSession 注释) */
export const getCurrentUser = cache(async () => {
  const session = await getSession()
  if (!session) return null

  const user = await db.user.findUnique({
    where: { id: session.userId },
    include: { profile: true },
  })
  if (!user) return null

  /**
   * ⚠️ 会话版本比对 —— 「改密码要能踢掉其他设备」靠的就是这一行。
   *
   *    会话是 30 天有效的 JWT、服务端不存 session,所以光改 passwordHash
   *    对已经签发出去的 token 没有任何影响。用户怀疑号被盗去改密码,
   *    攻击者手里那个 token 还能再用 30 天 —— 这和他改密码的预期正好相反。
   *
   *    改密码时 sessionVersion +1(见 login/actions.ts 的 setMyPassword),
   *    所有旧 token 在这里被判为失效。
   *    这一步不额外查库:上面那次 findUnique 本来就要做。
   */
  if ((session.sv ?? 0) !== user.sessionVersion) return null

  return user
})

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
export const getActiveSubscription = cache(async (userId: string) => {
  return db.subscription.findFirst({
    where: {
      userId,
      status: 'active',
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: { plan: true },
    orderBy: { paidAt: 'desc' },
  })
})

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

export const getAdminSession = cache(async (): Promise<AdminSessionPayload | null> => {
  const token = (await cookies()).get(ADMIN_COOKIE_NAME)?.value
  if (!token) return null
  const payload = await verify<AdminSessionPayload>(token)
  if (!payload) return null

  /**
   * ⚠️ 光验签不够 —— role / active 是登录那一刻烤进 JWT 的,之后从不复查。
   *    不回查库的话:在 /admin/accounts 停用一个管理员、或把 super_admin 降级,
   *    他手里的旧 token 在过期前(最长 30 天)仍是原权限,照样能改价、发 key、管账号。
   *    这里按 adminId 查一次库,以**库里的** active/role/delivererId 为准;
   *    账号被停用或已删除即视为未登录。一次带索引的主键查询,代价可接受。
   */
  const admin = await db.adminUser.findUnique({
    where: { id: payload.adminId },
    select: { active: true, role: true, delivererId: true, sessionVersion: true },
  })
  if (!admin || !admin.active) return null

  /**
   * ⚠️ 版本号对不上 = 这个 token 是改密码之前签发的,作废。
   *
   *    没有这一步的话,「改密码」对后台来说只是换了个登录口令 ——
   *    已经签发出去的 token 还能再活 30 天。号被盗时改密码是第一反应,
   *    而它此前对攻击者手里那个 token 毫无作用。学生端一直有这道校验
   *    (见上面 getSession),后台是这次才补上的。
   */
  if ((payload.sv ?? 0) !== admin.sessionVersion) return null

  return {
    adminId: payload.adminId,
    role: admin.role,
    delivererId: admin.delivererId,
    sv: admin.sessionVersion,
  }
})

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
