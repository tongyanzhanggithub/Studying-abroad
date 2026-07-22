'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth/session'
import { executeSettlement } from '@/lib/services/settlement'

/**
 * 执行月结。
 *
 * ⚠️ 限超管操作 —— 这一步会锁定应付金额,是财务动作。
 * ⚠️ 幂等:只处理未结算的订单,重复点击不会重复计账。
 */
export async function settleMonth(month: string) {
  await requireAdmin('super_admin')

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return { ok: false as const, error: '结算月份格式不正确' }
  }

  const res = await executeSettlement(month)
  revalidatePath('/admin/settlement')
  return { ok: true as const, ...res }
}
