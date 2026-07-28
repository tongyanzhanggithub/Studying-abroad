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

/**
 * 本地时区的「今天」,格式 YYYY-MM-DD。
 *
 * ⚠️ 不要用 `new Date().toISOString().slice(0, 10)` —— toISOString **永远返回 UTC**,
 *    跟系统时区无关。服务器设成 Asia/Shanghai 也救不了它。
 *
 *    踩过的坑:AI 每日配额的「天」原来就是这么算的,于是配额在
 *    **北京时间早上 8 点**才重置。学生半夜刷完额度,提示写着「明天再来」,
 *    真到零点却还是不能用 —— 这是付费用户会来投诉的那种。
 *
 *    同理,凡是要和用户口中的「今天 / 本月」对齐的地方,都必须走本地时区:
 *    配额、结算月份、截止日期过滤。用 getFullYear/getMonth/getDate,
 *    它们跟着 TZ 走(部署侧由 compass.service 的 TZ=Asia/Shanghai 钉死)。
 */
export function localDay(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
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
