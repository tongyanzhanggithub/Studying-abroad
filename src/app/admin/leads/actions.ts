'use server'

import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'

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
