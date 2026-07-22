import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 金额一律以分存储,展示时转元(PRD 4.8) */
export function formatCents(cents: number): string {
  return `¥${(cents / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

/** 距今天数;过去返回负数 */
export function daysUntil(date: Date | string | null | undefined): number | null {
  if (!date) return null
  const target = new Date(date)
  if (Number.isNaN(target.getTime())) return null
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const startOfTarget = new Date(target)
  startOfTarget.setHours(0, 0, 0, 0)
  return Math.round((startOfTarget.getTime() - startOfToday.getTime()) / 86_400_000)
}

/** 倒计时紧迫度配色:7 天内变橙、3 天内变红(PRD 4.3) */
export function deadlineUrgency(days: number | null): 'past' | 'critical' | 'warning' | 'normal' | 'none' {
  if (days === null) return 'none'
  if (days < 0) return 'past'
  if (days <= 3) return 'critical'
  if (days <= 7) return 'warning'
  return 'normal'
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '待公布'
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return '待公布'
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

/** 文案模板占位符替换:{n} {pct} {school} */
export function renderTemplate(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (match, key) =>
    key in vars ? String(vars[key]) : match,
  )
}

export function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  // 中英混排:英文按空格切词,中文按字符计
  const cjk = (trimmed.match(/[一-龥]/g) ?? []).length
  const latin = (trimmed.replace(/[一-龥]/g, ' ').match(/[A-Za-z0-9'’-]+/g) ?? []).length
  return cjk + latin
}

export function generateOutTradeNo(prefix: string): string {
  const ts = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `${prefix}${ts}${rand}`
}
