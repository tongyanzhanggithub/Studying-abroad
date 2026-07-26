'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { executeSettlement, previewSettlement, getSettledRows } from '@/lib/services/settlement'

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

/**
 * 标记某个交付人某月已打款 / 撤销标记。
 *
 * ⚠️ executeSettlement **不发起真实付款**,转账是财务在系统外做的。
 *    此前系统里完全没有「打没打钱」的记录,对不上账时只能翻聊天记录。
 *    这里只记事实(谁、何时、多少),不参与金额计算 —— 金额口径仍以
 *    ServiceOrder.payoutCents 为准,避免两处数字打架。
 */
export async function markPaidOut(params: {
  month: string
  delivererId: string
  note: string
  paid: boolean
}) {
  const admin = await requireAdmin('super_admin')

  if (!/^\d{4}-\d{2}$/.test(params.month)) {
    return { ok: false as const, error: '结算月份格式不正确' }
  }

  if (!params.paid) {
    // 撤销标记(打错人、金额有误时用)
    await db.settlementPayout.deleteMany({
      where: { month: params.month, delivererId: params.delivererId },
    })
    console.log(
      JSON.stringify({
        event: 'settlement.payout_unmarked',
        adminId: admin.adminId,
        month: params.month,
        delivererId: params.delivererId,
      }),
    )
    revalidatePath('/admin/settlement')
    return { ok: true as const }
  }

  /**
   * ⚠️ 金额与单数在**服务端重新算**,不接受前端传参。
   *
   *    这条记录是财务留痕,留痕的全部意义就是准确。让前端传金额意味着
   *    「记下来的数」和「实际该付的数」可以不一致 —— 那这张表就没有对账价值了。
   *    口径与结算表完全一致(都走 previewSettlement)。
   */
  // 打款通常发生在**结算之后**,所以先查已锁定的行;还没结算的也允许标记
  const settledRows = await getSettledRows(params.month)
  const row =
    settledRows.find((r) => r.delivererId === params.delivererId) ??
    (await previewSettlement(params.month)).find((r) => r.delivererId === params.delivererId)
  if (!row) {
    return {
      ok: false as const,
      error: '这个月这位交付人没有待结算的订单 —— 请确认月份和人选对了',
    }
  }

  await db.settlementPayout.upsert({
    where: {
      month_delivererId: { month: params.month, delivererId: params.delivererId },
    },
    create: {
      month: params.month,
      delivererId: params.delivererId,
      payoutCents: row.payoutCents,
      orderCount: row.orderCount,
      paidOutAt: new Date(),
      paidOutBy: admin.adminId,
      note: params.note.trim() || null,
    },
    update: {
      payoutCents: row.payoutCents,
      orderCount: row.orderCount,
      paidOutAt: new Date(),
      paidOutBy: admin.adminId,
      note: params.note.trim() || null,
    },
  })

  console.log(
    JSON.stringify({
      event: 'settlement.payout_marked',
      adminId: admin.adminId,
      month: params.month,
      delivererId: params.delivererId,
      payoutCents: row.payoutCents,
    }),
  )

  revalidatePath('/admin/settlement')
  return { ok: true as const }
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * 导出某月结算表 CSV —— 给财务对账用。
 *
 * 线索和院校库都有导出,唯独给财务的这张表没有,只能手抄。
 */
export async function exportSettlement(month: string) {
  await requireAdmin('super_admin')

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return { ok: false as const, error: '结算月份格式不正确' }
  }

  // 导出要含**已结算**的行,否则结算后导出只剩表头(见 getSettledRows 注释)
  const [pendingRows, settledRows, payouts] = await Promise.all([
    previewSettlement(month),
    getSettledRows(month),
    db.settlementPayout.findMany({ where: { month } }),
  ])
  const settledIds = new Set(settledRows.map((r) => r.delivererId))
  const rows = [...settledRows, ...pendingRows.filter((r) => !settledIds.has(r.delivererId))]
  const paidBy = new Map(payouts.map((p) => [p.delivererId, p]))

  const header = [
    '结算月份', '交付人', '角色', '微信', '分成比例',
    '订单数', '订单总额(元)', '应付(元)', '平台留存(元)',
    '是否已打款', '打款时间', '备注',
  ]
  const lines = [header.join(',')]

  for (const r of rows) {
    const p = paidBy.get(r.delivererId)
    lines.push(
      [
        month,
        r.delivererName,
        r.role,
        r.wxContact ?? '',
        `${Math.round(r.splitRatio * 100)}%`,
        r.orderCount,
        (r.grossCents / 100).toFixed(2),
        (r.payoutCents / 100).toFixed(2),
        (r.platformCents / 100).toFixed(2),
        p ? '已打款' : '未打款',
        p ? p.paidOutAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '',
        p?.note ?? '',
      ]
        .map(csvEscape)
        .join(','),
    )
  }

  // Excel 默认按 GBK 打开 UTF-8 会乱码,加 BOM
  return { ok: true as const, csv: '﻿' + lines.join('\n'), filename: `结算-${month}.csv` }
}
