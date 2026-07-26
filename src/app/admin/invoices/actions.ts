'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'

/**
 * 处理开票申请。
 *
 * 系统**不对接税务/开票平台** —— 财务在开票系统里开完票,回这里回填发票号即可。
 * 这张队列的价值是「不漏单」和「有据可查」,不是自动开票。
 */
export async function resolveInvoice(
  id: string,
  outcome: 'issued' | 'rejected',
  resultNote: string,
) {
  const admin = await requireAdmin('operator')

  if (!resultNote.trim()) {
    return {
      ok: false as const,
      error: outcome === 'issued' ? '请填写发票号码' : '请说明无法开具的原因(会展示给用户)',
    }
  }

  const res = await db.invoiceRequest.updateMany({
    where: { id, status: 'pending' },
    data: {
      status: outcome,
      resultNote: resultNote.trim().slice(0, 500),
      handledAt: new Date(),
      handledBy: admin.adminId,
    },
  })
  if (res.count === 0) {
    return { ok: false as const, error: '这条申请已经处理过了' }
  }

  console.log(
    JSON.stringify({
      event: 'invoice.resolved',
      adminId: admin.adminId,
      invoiceRequestId: id,
      outcome,
    }),
  )

  revalidatePath('/admin/invoices')
  revalidatePath('/app/orders')
  return { ok: true as const }
}
