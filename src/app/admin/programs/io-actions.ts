'use server'

import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { REGION_LABEL, DIRECTION_LABEL } from '@/lib/programs/types'
import {
  PROGRAM_COLUMNS,
  csvHeader,
  toCsvRow,
  parseCsv,
  mapHeader,
  normalizeRegion,
  normalizeDirection,
  parseBool,
  parseIntOrNull,
  parseDateOrNull,
  parseJsonCell,
  type ColumnKey,
} from '@/lib/programs/csv'

// ── 导出 ────────────────────────────────────────────────

/**
 * 把院校库导出成 Excel 可打开的 CSV。
 * filter 与列表页一致(pending / verified / stale / all),默认导全部。
 */
export async function exportPrograms(filter: string = 'all') {
  await requireAdmin('operator')

  const staleBefore = new Date(Date.now() - 180 * 86_400_000)
  const where =
    filter === 'pending'
      ? { confidence: { in: ['ai_collected' as const, 'unknown' as const] } }
      : filter === 'stale'
        ? { confidence: 'verified' as const, lastVerifiedAt: { lt: staleBefore } }
        : filter === 'verified'
          ? { confidence: 'verified' as const, lastVerifiedAt: { gte: staleBefore } }
          : {}

  const programs = await db.program.findMany({
    where,
    include: { school: true },
    orderBy: [{ region: 'asc' }, { schoolId: 'asc' }, { nameEn: 'asc' }],
  })

  const rows = programs.map((p) =>
    toCsvRow((key: ColumnKey) => {
      switch (key) {
        case 'id': return p.id
        case 'schoolNameEn': return p.school.nameEn
        case 'schoolNameZh': return p.school.nameZh ?? ''
        case 'schoolQsRank': return p.school.qsRank ?? ''
        case 'schoolQsRankYear': return p.school.qsRankYear ?? ''
        case 'schoolQsRankSourceUrl': return p.school.qsRankSourceUrl ?? ''
        case 'region': return p.region
        case 'nameEn': return p.nameEn
        case 'nameZh': return p.nameZh ?? ''
        case 'faculty': return p.faculty ?? ''
        case 'direction': return p.direction
        case 'durationMonths': return p.durationMonths ?? ''
        case 'tuition': return p.tuition ?? ''
        case 'campus': return p.campus ?? ''
        case 'finalDeadline': return p.finalDeadline ? p.finalDeadline.toISOString().slice(0, 10) : ''
        case 'isRolling': return p.isRolling ? '是' : '否'
        case 'isOnlineOnly': return p.isOnlineOnly ? '是' : '否'
        case 'competitiveness': return p.competitiveness ?? ''
        case 'active': return p.active ? '是' : '否'
        case 'confidence': return p.confidence
        case 'lastVerifiedAt': return p.lastVerifiedAt ? p.lastVerifiedAt.toISOString().slice(0, 10) : ''
        case 'requirementsJson': return JSON.stringify(p.requirements ?? {})
        case 'deadlinesJson': return JSON.stringify(p.deadlines ?? {})
        case 'notes': return p.notes ?? ''
      }
    }),
  )

  return { ok: true as const, csv: [csvHeader(), ...rows].join('\r\n'), count: programs.length }
}

/** 空模板:表头 + 一行示例,方便运营对着填 */
export async function exportProgramTemplate() {
  await requireAdmin('operator')
  const example = toCsvRow((key: ColumnKey) => {
    const sample: Partial<Record<ColumnKey, string>> = {
      schoolNameEn: 'University of Example',
      schoolNameZh: '示例大学',
      schoolQsRank: '25',
      schoolQsRankYear: '2026',
      region: 'UK',
      nameEn: 'MSc Example Studies',
      nameZh: '示例学理学硕士',
      direction: 'management',
      durationMonths: '12',
      tuition: '£30,000',
      isRolling: '否',
      isOnlineOnly: '否',
      active: '是',
      requirementsJson: '{}',
      deadlinesJson: '{}',
    }
    return sample[key] ?? ''
  })
  return { ok: true as const, csv: [csvHeader(), example].join('\r\n') }
}

// ── 导入 ────────────────────────────────────────────────

interface RowError {
  line: number
  reason: string
}

/**
 * 从 CSV 导入院校数据。
 *
 * ⚠️ 合规(PRD 4.2):导入 / 改动的项目一律落成「待核对」——
 *    confidence=ai_collected、lastVerifiedAt=null、verifiedBy=null,
 *    进入核对队列。Excel 导入不等于已核实。
 *
 * ⚠️ 过期截止日:早于今天的最终截止日一律置空(过期日期比没有日期更危险,
 *    用户会照着它规划),原值挪进备注供核对时参考。
 *
 * 匹配规则:有「项目ID」按 ID 更新;没有则按(学校+项目英文名)找,
 *    找到更新、找不到新建。学校按(英文名+地区)找,不存在就建。
 */
export async function importPrograms(csvText: string) {
  const admin = await requireAdmin('operator')

  const rows = parseCsv(csvText)
  if (rows.length < 2) {
    return { ok: false as const, error: '文件里没有数据行(至少要有表头 + 一行)' }
  }

  const header = mapHeader(rows[0])
  const required: ColumnKey[] = ['schoolNameEn', 'region', 'nameEn', 'direction']
  const missing = required.filter((k) => header[k] === undefined)
  if (missing.length) {
    const labels = missing.map((k) => PROGRAM_COLUMNS.find((c) => c.key === k)?.label)
    return { ok: false as const, error: `缺少必需的列:${labels.join('、')}` }
  }

  const cell = (row: string[], key: ColumnKey): string => {
    const idx = header[key]
    return idx === undefined ? '' : (row[idx] ?? '').trim()
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  let created = 0
  let updated = 0
  const errors: RowError[] = []

  // 第 0 行是表头,数据从第 1 行开始;line 用 1-based 且含表头,便于对照 Excel 行号
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const line = r + 1
    try {
      const region = normalizeRegion(cell(row, 'region'))
      if (!region) {
        errors.push({ line, reason: `地区无法识别:「${cell(row, 'region')}」` })
        continue
      }
      const direction = normalizeDirection(cell(row, 'direction'))
      if (!direction) {
        errors.push({ line, reason: `方向无法识别:「${cell(row, 'direction')}」` })
        continue
      }
      const schoolNameEn = cell(row, 'schoolNameEn')
      const nameEn = cell(row, 'nameEn')
      if (!schoolNameEn || !nameEn) {
        errors.push({ line, reason: '学校英文名或项目英文名为空' })
        continue
      }

      const requirements = parseJsonCell(cell(row, 'requirementsJson'))
      const deadlines = parseJsonCell(cell(row, 'deadlinesJson'))
      if (requirements === null || deadlines === null) {
        errors.push({ line, reason: '录取要求JSON 或 时间线JSON 格式不合法' })
        continue
      }

      // 学校:按(英文名+地区)找,没有就建
      const qsRank = parseIntOrNull(cell(row, 'schoolQsRank'))
      const qsRankYear = parseIntOrNull(cell(row, 'schoolQsRankYear'))
      const school = await db.school.upsert({
        where: { nameEn_region: { nameEn: schoolNameEn, region } },
        create: {
          nameEn: schoolNameEn,
          nameZh: cell(row, 'schoolNameZh') || null,
          region,
          qsRank,
          qsRankYear,
          qsRankSourceUrl: cell(row, 'schoolQsRankSourceUrl') || null,
        },
        update: {
          nameZh: cell(row, 'schoolNameZh') || undefined,
          qsRank: cell(row, 'schoolQsRank') ? qsRank : undefined,
          qsRankYear: cell(row, 'schoolQsRankYear') ? qsRankYear : undefined,
          qsRankSourceUrl: cell(row, 'schoolQsRankSourceUrl') || undefined,
        },
      })

      // 过期截止日兜底
      let finalDeadline = parseDateOrNull(cell(row, 'finalDeadline'))
      let extraNote = cell(row, 'notes') || ''
      if (finalDeadline && finalDeadline < today) {
        extraNote = `${extraNote}${extraNote ? ' | ' : ''}导入时最终截止日 ${finalDeadline
          .toISOString()
          .slice(0, 10)} 已过期,已置空待核对`.trim()
        finalDeadline = null
      }

      const data = {
        nameZh: cell(row, 'nameZh') || null,
        faculty: cell(row, 'faculty') || null,
        direction,
        region,
        durationMonths: parseIntOrNull(cell(row, 'durationMonths')),
        tuition: cell(row, 'tuition') || null,
        campus: cell(row, 'campus') || null,
        finalDeadline,
        isRolling: parseBool(cell(row, 'isRolling'), false),
        isOnlineOnly: parseBool(cell(row, 'isOnlineOnly'), false),
        competitiveness: cell(row, 'competitiveness') || null,
        active: parseBool(cell(row, 'active'), true),
        requirements,
        deadlines,
        notes: extraNote || null,
        // ⚠️ 合规:导入 = 待核对,不继承任何"已核实"状态
        confidence: 'ai_collected' as const,
        lastVerifiedAt: null,
        verifiedBy: null,
      }

      const id = cell(row, 'id')
      // ID 命中优先;否则按(学校+项目英文名)找
      const existing = id
        ? await db.program.findUnique({ where: { id } })
        : await db.program.findUnique({
            where: { schoolId_nameEn: { schoolId: school.id, nameEn } },
          })

      if (existing) {
        await db.program.update({
          where: { id: existing.id },
          data: { ...data, schoolId: school.id, nameEn },
        })
        updated++
      } else {
        await db.program.create({
          data: { ...data, schoolId: school.id, nameEn },
        })
        created++
      }
    } catch (err) {
      console.error(`[programs:import] 第 ${line} 行失败`, err)
      errors.push({ line, reason: '写入失败(数据可能不合法)' })
    }
  }

  console.info(
    `[programs:import] 管理员 ${admin.adminId} 导入:新增 ${created}、更新 ${updated}、失败 ${errors.length}`,
  )

  return {
    ok: true as const,
    created,
    updated,
    failed: errors.length,
    errors: errors.slice(0, 50), // 最多回传 50 条,避免响应过大
    total: rows.length - 1,
  }
}
