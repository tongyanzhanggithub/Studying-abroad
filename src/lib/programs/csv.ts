import 'server-only'
import { REGION_LABEL, DIRECTION_LABEL, DIRECTION_ORDER } from '@/lib/programs/types'
import type { Region, Direction } from '@prisma/client'

/**
 * 院校数据的 Excel(CSV)导入/导出列定义与解析。
 *
 * ── 为什么用 CSV 而不是 .xlsx ────────────────────────────
 * CSV 带 UTF-8 BOM,Excel 双击直接打开、编辑、另存都认;而 .xlsx 要引入
 * SheetJS 之类的二进制库。后台线索导出早就是这套 CSV 方案,保持一致、
 * 不多加依赖。Excel 里改完「另存为 CSV UTF-8」就能再导回来。
 *
 * ── 合规红线(PRD 4.2)────────────────────────────────────
 * 导入的数据一律落成「待核对」(confidence=ai_collected, lastVerifiedAt=null),
 * 不因为是 Excel 导入就当成已核实。核对通过前不作为确定值展示给用户。
 */

/** 列顺序即导出表头顺序。key 用于代码内引用,label 是 Excel 里看到的中文表头。 */
export const PROGRAM_COLUMNS = [
  { key: 'id', label: '项目ID' },
  { key: 'schoolNameEn', label: '学校英文名' },
  { key: 'schoolNameZh', label: '学校中文名' },
  { key: 'schoolQsRank', label: 'QS排名' },
  { key: 'schoolQsRankYear', label: 'QS年份' },
  { key: 'schoolQsRankSourceUrl', label: 'QS来源链接' },
  { key: 'region', label: '地区' },
  { key: 'nameEn', label: '项目英文名' },
  { key: 'nameZh', label: '项目中文名' },
  { key: 'faculty', label: '院系' },
  { key: 'direction', label: '方向' },
  { key: 'durationMonths', label: '学制月数' },
  { key: 'tuition', label: '学费' },
  { key: 'campus', label: '校区' },
  { key: 'finalDeadline', label: '最终截止日' },
  { key: 'isRolling', label: '滚动录取' },
  { key: 'isOnlineOnly', label: '纯线上' },
  { key: 'competitiveness', label: '竞争度' },
  { key: 'active', label: '上架' },
  { key: 'confidence', label: '置信度(仅导出)' },
  { key: 'lastVerifiedAt', label: '最后核对(仅导出)' },
  { key: 'requirementsJson', label: '录取要求JSON' },
  { key: 'deadlinesJson', label: '时间线JSON' },
  { key: 'notes', label: '备注' },
] as const

export type ColumnKey = (typeof PROGRAM_COLUMNS)[number]['key']

// ── 序列化 ──────────────────────────────────────────────

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 一行数据(按 ColumnKey 取值)→ CSV 行 */
export function toCsvRow(get: (key: ColumnKey) => unknown): string {
  return PROGRAM_COLUMNS.map((c) => csvEscape(get(c.key))).join(',')
}

export function csvHeader(): string {
  return PROGRAM_COLUMNS.map((c) => csvEscape(c.label)).join(',')
}

// ── 解析 ────────────────────────────────────────────────

/**
 * 一个能处理引号包裹、字段内逗号/换行、双引号转义、CRLF 与 BOM 的 CSV 解析器。
 * 不用第三方库 —— 规则简单,自己写反而没有版本与体积负担。
 */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '') // 去掉 Excel 存的 BOM
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"' && field === '') {
      // 只有在字段开头的引号才是「引号包裹」的开始;
      // 字段中间冒出来的引号(畸形输入)当普通字符,不吞后面的内容
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      // 吃掉 \r\n 的 \n
      if (ch === '\r' && clean[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  // 最后一个字段/行(文件末尾没有换行时)
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== '')) // 丢掉全空行
}

/**
 * 把表头行映射成 ColumnKey → 列索引。
 * 认中文 label,也认英文 key —— 运营手改表头、或用旧文件都能对上。
 */
export function mapHeader(header: string[]): Partial<Record<ColumnKey, number>> {
  const labelToKey = new Map<string, ColumnKey>()
  for (const c of PROGRAM_COLUMNS) {
    labelToKey.set(c.label, c.key)
    labelToKey.set(c.key, c.key)
  }
  const map: Partial<Record<ColumnKey, number>> = {}
  header.forEach((h, i) => {
    const key = labelToKey.get(h.trim())
    if (key && map[key] === undefined) map[key] = i
  })
  return map
}

// ── 值归一化 ────────────────────────────────────────────

const REGION_ALIASES: Record<string, Region> = (() => {
  const m: Record<string, Region> = {}
  for (const code of Object.keys(REGION_LABEL) as Region[]) {
    m[code.toLowerCase()] = code // 认代码 UK/HK…
    m[REGION_LABEL[code]] = code // 认中文名 英国/中国香港…
  }
  // 常见别名补充
  Object.assign(m, {
    香港: 'HK', 澳门: 'MO', 澳洲: 'AU', britain: 'UK', england: 'UK',
  } as Record<string, Region>)
  return m
})()

export function normalizeRegion(raw: string): Region | null {
  const t = raw.trim()
  return REGION_ALIASES[t] ?? REGION_ALIASES[t.toLowerCase()] ?? null
}

const DIRECTION_ALIASES: Record<string, Direction> = (() => {
  const m: Record<string, Direction> = {}
  for (const code of DIRECTION_ORDER as readonly Direction[]) {
    m[code.toLowerCase()] = code
    if (DIRECTION_LABEL[code]) m[DIRECTION_LABEL[code]] = code
  }
  return m
})()

export function normalizeDirection(raw: string): Direction | null {
  const t = raw.trim()
  return DIRECTION_ALIASES[t] ?? DIRECTION_ALIASES[t.toLowerCase()] ?? null
}

/** 「是/否/true/1」→ boolean;空 → 默认值 */
export function parseBool(raw: string, fallback: boolean): boolean {
  const t = raw.trim().toLowerCase()
  if (t === '') return fallback
  return ['是', 'true', '1', 'y', 'yes'].includes(t)
}

/** 数字列:空 → null,非法 → null */
export function parseIntOrNull(raw: string): number | null {
  const t = raw.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n) : null
}

/** 日期列:接受 YYYY-MM-DD;空或非法 → null */
export function parseDateOrNull(raw: string): Date | null {
  const t = raw.trim()
  if (!t) return null
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? null : d
}

/** JSON 列:空 → {};非法 → null(交由调用方决定是否记为错误) */
export function parseJsonCell(raw: string): object | null {
  const t = raw.trim()
  if (!t) return {}
  try {
    const v = JSON.parse(t)
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}
