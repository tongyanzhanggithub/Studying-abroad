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
  /**
   * 向支付渠道发起退款。**只负责调渠道**,本地 Payment 行的状态由 executeRefund 统一更新。
   *
   * ⚠️ outRefundNo 是幂等键:微信退款按商户退款单号去重。传同一个 outRefundNo 重复调用,
   *    微信只会退一次 —— 这正是防「并发/重试退两笔真钱」的关键,缺它则每次都是新退款。
   */
  refund(params: {
    paymentId: string
    outTradeNo: string
    amountCents: number
    reason: string
    outRefundNo: string
  }): Promise<void>
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

  async refund(): Promise<void> {
    // mock 渠道无真实退款动作 —— 本地 Payment 行由 executeRefund 统一置为已退款。
    // 这里留空即可(保留方法以满足接口)。
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
    //   幂等键 out_refund_no 由 executeRefund 传入(RF- + paymentId,同一支付单恒定),
    //   微信按它去重 —— 直接透传,不要另生成随机值。
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

export type RefundResult =
  | { ok: true; alreadyRefunded: boolean }
  | { ok: false; error: string }

/**
 * 幂等地对一笔支付发起退款(渠道无关)。
 *
 * ⚠️ 原来的退款是「findFirst → provider.refund → update」三步无锁,并发/重试会:
 *    ① 两次都读到 succeeded 各调一次退款;② provider.refund 没有幂等键 →
 *    接真实微信后就是**两笔真钱**。这里统一收口:
 *
 *   1. 用条件更新**原子抢锁**(succeeded → refunded),抢不到说明已退过,直接当成功返回;
 *   2. outRefundNo 用 `RF-<paymentId>` **恒定值**,微信按它去重,天然幂等;
 *   3. 渠道退款失败则**回滚**本地状态,避免「本地显示已退、钱其实没退」。
 *
 * 只处理 Payment 行;订单/订阅的业务状态由调用方按各自状态机推进。
 */
export async function executeRefund(
  paymentId: string,
  refundableCents: number,
  reason: string,
): Promise<RefundResult> {
  const payment = await db.payment.findUnique({ where: { id: paymentId } })
  if (!payment) return { ok: false, error: '找不到对应的支付记录' }
  if (payment.status === 'refunded') return { ok: true, alreadyRefunded: true }
  if (payment.status !== 'succeeded') {
    return { ok: false, error: '该支付单当前状态不可退款' }
  }

  const now = new Date()
  // 原子抢锁:只有把 succeeded→refunded 抢到手的那次继续,并发的另一方 count===0
  const claimed = await db.payment.updateMany({
    where: { id: paymentId, status: 'succeeded' },
    data: { status: 'refunded', refundedCents: refundableCents, refundReason: reason, refundedAt: now },
  })
  if (claimed.count === 0) return { ok: true, alreadyRefunded: true }

  try {
    await getPaymentProvider().refund({
      paymentId,
      outTradeNo: payment.outTradeNo,
      amountCents: refundableCents,
      reason,
      outRefundNo: `RF-${paymentId}`, // 恒定幂等键
    })
  } catch (err) {
    // 渠道退款失败 → 回滚本地状态,别让订单停在「已退款」而钱没退
    await db.payment.updateMany({
      where: { id: paymentId, status: 'refunded' },
      data: { status: 'succeeded', refundedCents: null, refundReason: null, refundedAt: null },
    })
    console.error(`[refund] 渠道退款失败,已回滚本地状态 payment=${paymentId}`, err)
    return { ok: false, error: '退款渠道处理失败,请稍后重试' }
  }

  return { ok: true, alreadyRefunded: false }
}

// ── 退款规则(PRD 4.8:写进产品逻辑,不只写在协议里)──────

// 退款的纯计算部分抽到 refund-math.ts(不依赖 env / db,可直接单测)。
// 这里继续导出,免得调用方要区分从哪个文件 import。
export {
  FULL_REFUND_DAYS,
  calcSubscriptionRefund,
  calcServiceRefund,
  type RefundDecision,
} from './refund-math'
