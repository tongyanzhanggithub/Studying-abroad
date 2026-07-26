'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'

/**
 * 标记线索已跟进 / 取消标记。
 *
 * ⚠️ `Lead.followedUpAt` 此前**只有读、没有任何写入方** —— 页面拿它算
 *    「超 48 小时未跟进」,却没有任何地方能把它置上。结果「待跟进」这个数字
 *    单调递增、永远清不掉,跟进流程根本跑不起来,运营看两天就不看了。
 */
export async function markFollowedUp(leadId: string, followed: boolean) {
  await requireAdmin('operator')
  await db.lead.update({
    where: { id: leadId },
    data: { followedUpAt: followed ? new Date() : null },
  })
  revalidatePath('/admin/leads')
  return { ok: true as const }
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function exportLeads() {
  await requireAdmin('operator')

  const leads = await db.lead.findMany({ orderBy: { createdAt: 'desc' } })

  const header = [
    '手机号', '本科层级', '本科专业', 'GPA', '计分制',
    '语言类型', '语言分数', '意向地区', '目标方向', '来源渠道', '创建时间', '是否转化',
  ]

  const rows = leads.map((l) => {
    const p = l.assessPayload as Record<string, unknown>
    return [
      l.phone,
      p.undergradTier, p.undergradMajor, p.gpa, p.gpaScale,
      p.languageType, p.languageScore,
      Array.isArray(p.targetRegions) ? p.targetRegions.join('|') : '',
      p.targetDirection,
      l.sourceChannel ?? '',
      l.createdAt.toISOString(),
      l.convertedUserId ? '是' : '否',
    ].map(csvEscape).join(',')
  })

  return { ok: true as const, csv: [header.join(','), ...rows].join('\n') }
}
