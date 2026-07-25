import { NextResponse, type NextRequest } from 'next/server'
import { getPaymentProvider } from '@/lib/payment'
import { fulfillPayment } from '@/lib/payment/fulfill'

/**
 * 微信支付回调(异步通知)。
 *
 * ⚠️ 现在 WechatPaymentProvider.parseCallback 还是占位(throw)—— 商户号到位、
 *    实现验签+解密后本路由即可直接工作。留在这里是为了把「回调 → 履约」的接线先固定住:
 *
 *   1. parseCallback 必须**先验签再解密**(用微信平台证书验 Wechatpay-Signature,
 *      用 APIv3 密钥 AES-256-GCM 解密 resource),失败一律拒绝。
 *   2. ⚠️ 关键:传给 fulfillPayment 的 amountCents 必须是**回调里的金额**,
 *      这样 fulfill 内的「本地金额 vs 回调金额」核对才有意义(本地传本地等于没校验)。
 *   3. fulfillPayment 幂等(原子抢锁),微信毫秒级重投不会重复履约。
 *   4. 对已处理/未知单也要回 200 成功应答,否则微信会无限重投。
 */
export async function POST(request: NextRequest) {
  const provider = getPaymentProvider()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ code: 'FAIL', message: '报文解析失败' }, { status: 400 })
  }

  const headers: Record<string, string> = {}
  request.headers.forEach((v, k) => {
    headers[k] = v
  })

  let callback
  try {
    // 验签 + 解密都在这里;失败会 throw,绝不放行未验签的回调
    callback = await provider.parseCallback(body, headers)
  } catch (err) {
    console.error('[wechat notify] 回调验签/解析失败', err)
    // 验签失败返回失败应答,微信会重试;但绝不履约
    return NextResponse.json({ code: 'FAIL', message: '验签失败' }, { status: 401 })
  }

  if (!callback.success) {
    // 支付未成功的通知:应答成功以停止重投,但不履约
    return NextResponse.json({ code: 'SUCCESS', message: 'OK' })
  }

  try {
    await fulfillPayment({
      outTradeNo: callback.outTradeNo,
      transactionId: callback.transactionId,
      // ⚠️ 用回调金额,让 fulfill 的金额核对真正生效
      amountCents: callback.amountCents,
      raw: callback.raw,
    })
  } catch (err) {
    // 履约失败(如金额不匹配)记日志并返回失败,让微信重投 + 人工介入
    console.error('[wechat notify] 履约失败', err)
    return NextResponse.json({ code: 'FAIL', message: '履约失败' }, { status: 500 })
  }

  // 已处理成功 —— 回成功应答,微信停止重投
  return NextResponse.json({ code: 'SUCCESS', message: 'OK' })
}
