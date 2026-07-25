import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { env } from '@/lib/env'

/**
 * 校验 cron / 开发自检接口的共享密钥(x-cron-secret 头)。
 *
 * ⚠️ 用 timingSafeEqual 做**恒定时间**比较,不用 `!==`。
 *    普通字符串比较会在第一个不同字符处提前返回,理论上可通过计时逐字节猜密钥。
 *    这几个接口都能推进订单状态 / 触发结算,值得和会话、密码一样规范对待。
 */
export function isValidCronSecret(header: string | null): boolean {
  if (!header) return false
  const a = Buffer.from(header)
  const b = Buffer.from(env.cronSecret)
  // 长度不同时 timingSafeEqual 会抛错,先挡掉;长度本身不是秘密
  return a.length === b.length && timingSafeEqual(a, b)
}
