import 'server-only'
import { env } from '@/lib/env'
import { db } from '@/lib/db'
import { generateOutTradeNo } from '@/lib/utils'
import type { OrderType } from '@prisma/client'

/**
 * 支付适配器。
 *
 * 微信支付商户号需要营业执照,申请周期约 1 周(PRD 2.3),属关键路径外部依赖。
 * 因此支付走接口抽象:开发期用 MockProvider 跑通全链路,商户号到位后
 * 只需实现 WechatProvider 并把 PAYMENT_PROVIDER 切成 wechat,业务代码零改动。
 */

export interface CreatePaymentParams {
  userId: string
  orderType: OrderType
  orderId: string
  amountCents: number
  subject: string
}

export interface CreatePaymentResult {
  paymentId: string
  outTradeNo: string
  /** 微信 Native 支付二维码链接;mock 下是本地确认页 */
  payUrl: string
}

export interface PaymentCallback {
  outTradeNo: string
  transactionId: string
  amountCents: number
  success: boolean
  raw: unknown
}

export interface PaymentProvider {
  readonly channel: string
  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>
  /** 验签并解析渠道回调 —— 微信实现必须验签,不可跳过 */
  parseCallback(body: unknown, headers: Record<string, string>): Promise<PaymentCallback>
  refund(paymentId: string, amountCents: number, reason: string): Promise<void>
}

// ── Mock ────────────────────────────────────────────────

class MockPaymentProvider implements PaymentProvider {
  readonly channel = 'mock'

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const outTradeNo = generateOutTradeNo('MOCK')
    const payment = await db.payment.create({
      data: {
        userId: params.userId,
        orderType: params.orderType,
        orderId: params.orderId,
        channel: this.channel,
        amountCents: params.amountCents,
        outTradeNo,
        status: 'created',
      },
    })
    return {
      paymentId: payment.id,
      outTradeNo,
      // mock 下跳到本地确认页,点一下即视为支付成功
      payUrl: `/pay/mock/${outTradeNo}`,
    }
  }

  async parseCallback(body: unknown): Promise<PaymentCallback> {
    const b = body as { outTradeNo: string; amountCents: number }
    return {
      outTradeNo: b.outTradeNo,
      transactionId: `MOCKTXN${Date.now()}`,
      amountCents: b.amountCents,
      success: true,
      raw: body,
    }
  }

  async refund(paymentId: string, amountCents: number, reason: string): Promise<void> {
    await db.payment.update({
      where: { id: paymentId },
      data: {
        status: 'refunded',
        refundedCents: amountCents,
        refundReason: reason,
        refundedAt: new Date(),
      },
    })
  }
}

// ── 微信支付(待商户号)────────────────────────────────

class WechatPaymentProvider implements PaymentProvider {
  readonly channel = 'wechat'

  async createPayment(): Promise<CreatePaymentResult> {
    // TODO: 接入微信支付 v3 Native 下单
    //   POST https://api.mch.weixin.qq.com/v3/pay/transactions/native
    //   需要:商户号、APIv3 密钥、商户证书私钥、证书序列号
    //   注意:金额字段 total 单位为分,与本系统存储一致
    throw new Error('微信支付尚未接入 —— 需要先拿到商户号与证书')
  }

  async parseCallback(): Promise<PaymentCallback> {
    // TODO: 必须做以下三件事,缺一不可:
    //   1. 用微信平台证书验签 Wechatpay-Signature
    //   2. 用 APIv3 密钥 AES-256-GCM 解密 resource
    //   3. 校验金额与本地订单一致(防金额篡改)
    throw new Error('微信支付回调尚未接入')
  }

  async refund(): Promise<void> {
    // TODO: POST /v3/refund/domestic/refunds
    throw new Error('微信退款尚未接入')
  }
}

let cached: PaymentProvider | null = null

export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached
  cached =
    env.payment.provider === 'wechat'
      ? new WechatPaymentProvider()
      : new MockPaymentProvider()
  return cached
}

// ── 退款规则(PRD 4.8:写进产品逻辑,不只写在协议里)──────

export interface RefundDecision {
  allowed: boolean
  /** 可退金额(分) */
  refundableCents: number
  reason: string
}

/**
 * 系统季票退款计算。
 *   · 购买 7 天内且核心模块使用 <3 次 → 全退
 *   · 之后按剩余月份阶梯退
 */
export function calcSubscriptionRefund(params: {
  amountCents: number
  paidAt: Date
  expiresAt: Date | null
  coreModuleUseCount: number
}): RefundDecision {
  const { amountCents, paidAt, expiresAt, coreModuleUseCount } = params
  const daysSincePaid = (Date.now() - paidAt.getTime()) / 86_400_000

  if (daysSincePaid <= 7 && coreModuleUseCount < 3) {
    return {
      allowed: true,
      refundableCents: amountCents,
      reason: '购买 7 天内且核心功能使用少于 3 次,可全额退款',
    }
  }

  if (!expiresAt) {
    return { allowed: false, refundableCents: 0, reason: '该订阅无到期日,不支持按月退款' }
  }

  const totalMs = expiresAt.getTime() - paidAt.getTime()
  const remainingMs = expiresAt.getTime() - Date.now()
  if (remainingMs <= 0) {
    return { allowed: false, refundableCents: 0, reason: '订阅已到期,不可退款' }
  }

  const remainingMonths = Math.floor(remainingMs / (30 * 86_400_000))
  const totalMonths = Math.max(1, Math.round(totalMs / (30 * 86_400_000)))
  if (remainingMonths < 1) {
    return { allowed: false, refundableCents: 0, reason: '剩余不足 1 个月,不可退款' }
  }

  const refundable = Math.floor((amountCents * remainingMonths) / totalMonths)
  return {
    allowed: true,
    refundableCents: refundable,
    reason: `按剩余 ${remainingMonths} 个月/共 ${totalMonths} 个月阶梯退款`,
  }
}

/**
 * 单点服务退款计算。
 *   · 交付人接单前 → 全退
 *   · 接单后交付前 → 退 50%
 *   · 交付后 → 不退
 */
export function calcServiceRefund(params: {
  amountCents: number
  assignedAt: Date | null
  deliveredAt: Date | null
}): RefundDecision {
  const { amountCents, assignedAt, deliveredAt } = params

  if (deliveredAt) {
    return { allowed: false, refundableCents: 0, reason: '服务已交付,不支持退款' }
  }
  if (assignedAt) {
    return {
      allowed: true,
      refundableCents: Math.floor(amountCents / 2),
      reason: '交付人已接单但尚未交付,可退 50%',
    }
  }
  return {
    allowed: true,
    refundableCents: amountCents,
    reason: '交付人尚未接单,可全额退款',
  }
}
