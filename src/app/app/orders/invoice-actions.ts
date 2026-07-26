'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import type { InvoiceTitleType } from '@prisma/client'

/**
 * 开票申请。
 *
 * ⚠️ 金额与开票内容**不让用户填** —— 一律以关联的 Payment 为准。
 *    让用户自己填金额等于把开票金额交给前端,那是财税风险。
 */
export async function requestInvoice(input: {
  paymentId: string
  titleType: InvoiceTitleType
  title: string
  taxNumber: string
  email: string
  note: string
}) {
  const user = await requireUser()

  // 归属校验:只能给自己的、且已支付成功的单开票
  const payment = await db.payment.findFirst({
    where: { id: input.paymentId, userId: user.id, status: 'succeeded' },
  })
  if (!payment) {
    return { ok: false as const, error: '找不到这笔支付记录,或它还未支付成功' }
  }

  const title = input.title.trim()
  const email = input.email.trim()
  const taxNumber = input.taxNumber.trim()

  if (!title) return { ok: false as const, error: '请填写发票抬头' }
  if (input.titleType === 'company' && !taxNumber) {
    return { ok: false as const, error: '企业抬头必须填写纳税人识别号,否则发票无法使用' }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false as const, error: '请填写正确的邮箱 —— 电子发票会发到这里' }
  }

  const existing = await db.invoiceRequest.findUnique({
    where: { paymentId: payment.id },
  })
  if (existing) {
    return { ok: false as const, error: '这笔订单已经申请过发票了,请勿重复提交' }
  }

  await db.invoiceRequest.create({
    data: {
      userId: user.id,
      paymentId: payment.id,
      titleType: input.titleType,
      title,
      taxNumber: input.titleType === 'company' ? taxNumber : null,
      email,
      note: input.note.trim() || null,
    },
  })

  revalidatePath('/app/orders')
  return { ok: true as const }
}
