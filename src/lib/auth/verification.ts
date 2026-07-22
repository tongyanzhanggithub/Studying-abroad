import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { env } from '@/lib/env'

const CODE_TTL_MINUTES = 10
/** 同一手机号发码频率限制 */
const RESEND_COOLDOWN_SECONDS = 60
const MAX_CODES_PER_HOUR = 5

/**
 * 同一 IP 每小时最多发多少条(跨手机号)。
 *
 * ⚠️ 按手机号限流只能挡「反复轰炸一个号」,挡不住「换一批号刷」——
 *    后者才是真正烧短信费、还骚扰真实机主的攻击。正常用户一小时内
 *    绝不会从同一 IP 给 20 个不同号码发码,所以这个上限只会挡到攻击者。
 *    放在手机号限流之外的第二道闸,两道都过才真的发。
 */
const MAX_CODES_PER_IP_HOUR = 20

/**
 * 同一个验证码最多能试几次。
 *
 * ⚠️ 之前没有这个限制,6 位验证码可以在 10 分钟有效期内**无限次爆破** ——
 *    知道手机号就能撞开账号,而账号里存着护照和身份证扫描件。
 *    5 次之后这条码直接作废,要重新发码(重新发码本身还有 60 秒冷却
 *    和每小时 5 条的上限,合起来把爆破成本抬到不可行)。
 */
const MAX_ATTEMPTS = 5

export class VerificationError extends Error {}

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

/**
 * 验证码不存明文。
 *
 * 数据库里躺着一堆有效期内的明文验证码,等于拖库就能登录任意账号。
 * 用 HMAC 而不是裸 hash:6 位数字空间只有 100 万,裸 sha256 打一张彩虹表
 * 几秒就能反查;掺进 AUTH_SECRET 之后,没有这把密钥就查不了。
 * 带上 phone 是为了让同一个码在不同手机号下有不同摘要。
 */
function hashCode(phone: string, code: string): string {
  return createHmac('sha256', env.authSecret).update(`${phone}:${code}`).digest('hex')
}

export function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone)
}

/**
 * 下发验证码。
 * SMS_PROVIDER=mock 时不真实下发,验证码打印到服务端日志,
 * 并在开发环境随响应返回,方便本地联调。
 */
export async function sendVerificationCode(
  phone: string,
  ip?: string | null,
): Promise<{ devCode?: string }> {
  if (!isValidPhone(phone)) throw new VerificationError('手机号格式不正确')

  const now = Date.now()
  const hourAgo = new Date(now - 3600_000)

  const recent = await db.verificationCode.findFirst({
    where: { phone },
    orderBy: { createdAt: 'desc' },
  })
  if (recent && now - recent.createdAt.getTime() < RESEND_COOLDOWN_SECONDS * 1000) {
    throw new VerificationError(`请 ${RESEND_COOLDOWN_SECONDS} 秒后再试`)
  }

  const countThisHour = await db.verificationCode.count({
    where: { phone, createdAt: { gte: hourAgo } },
  })
  if (countThisHour >= MAX_CODES_PER_HOUR) {
    throw new VerificationError('验证码请求过于频繁,请稍后再试')
  }

  /**
   * 第二道闸:同一 IP 跨手机号的小时上限。
   * 拿不到 IP 时(理论上不该发生)不因此放行也不因此拦死 —— 跳过这道,
   * 手机号那道仍在。只有确实拿到 IP 且超限才拦。
   */
  if (ip) {
    const ipCountThisHour = await db.verificationCode.count({
      where: { ip, createdAt: { gte: hourAgo } },
    })
    if (ipCountThisHour >= MAX_CODES_PER_IP_HOUR) {
      // 提示语故意含糊 —— 不告诉对方触发的是 IP 维度的限制
      throw new VerificationError('验证码请求过于频繁,请稍后再试')
    }
  }

  const code = generateCode()
  await db.verificationCode.create({
    data: {
      phone,
      ip: ip ?? null,
      code: hashCode(phone, code),
      expiresAt: new Date(now + CODE_TTL_MINUTES * 60_000),
    },
  })

  if (env.sms.provider === 'mock') {
    /**
     * ⚠️ 生产环境 + mock 短信 = 用户永远收不到验证码,**没有人能登录**。
     *    默认必须直接失败,不能假装成功 —— 假装成功的话用户会一直
     *    在登录页等一条永远不会到的短信,而日志里静静躺着他的验证码。
     */
    if (env.isProd) {
      if (!env.sms.allowMockInProd) {
        console.error('[SMS] 生产环境仍在使用 mock 短信 —— 用户无法登录,请尽快接入阿里云短信')
        throw new VerificationError('短信服务尚未开通,暂时无法登录。请联系客服。')
      }
      /**
       * 演示模式:码只进日志,**不随响应返回**。
       * 能登录的前提是能读服务器日志(有 SSH)—— 公网上的人拿不到别人的码。
       */
      console.warn(
        `[SMS:demo] ⚠️ ALLOW_MOCK_SMS 已开启(演示模式)。${phone} 的验证码是 ${code},` +
          `${CODE_TTL_MINUTES} 分钟内有效。接入真实短信后请立刻删掉这个开关。`,
      )
      return {}
    }
    console.info(`[SMS:mock] ${phone} 的验证码是 ${code}(${CODE_TTL_MINUTES} 分钟内有效)`)
    return { devCode: code }
  }

  // TODO: 接入阿里云短信。需要营业执照 + 签名报备,资质下来后在此实现。
  throw new VerificationError('短信服务尚未配置')
}

/** 校验并消费验证码 */
export async function consumeVerificationCode(phone: string, code: string): Promise<void> {
  const record = await db.verificationCode.findFirst({
    where: { phone, consumed: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })
  if (!record) throw new VerificationError('验证码错误或已过期')

  if (record.attempts >= MAX_ATTEMPTS) {
    // 直接作废,逼对方重新发码 —— 重发有冷却和小时上限
    await db.verificationCode.update({
      where: { id: record.id },
      data: { consumed: true },
    })
    throw new VerificationError('验证码错误次数过多,请重新获取')
  }

  const expected = Buffer.from(record.code, 'hex')
  const actual = Buffer.from(hashCode(phone, code), 'hex')
  const ok = expected.length === actual.length && timingSafeEqual(expected, actual)

  if (!ok) {
    await db.verificationCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    })
    const left = MAX_ATTEMPTS - record.attempts - 1
    throw new VerificationError(
      left > 0 ? `验证码错误(还可以试 ${left} 次)` : '验证码错误次数过多,请重新获取',
    )
  }

  await db.verificationCode.update({
    where: { id: record.id },
    data: { consumed: true },
  })
}
