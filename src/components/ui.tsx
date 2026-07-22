import { cn } from '@/lib/utils'

export function Card({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('rounded-xl border border-ink-200 bg-white p-5', className)}>
      {children}
    </div>
  )
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        // 移动端触控目标不低于 44px(iOS HIG),桌面端恢复紧凑尺寸
        size === 'sm' && 'min-h-11 px-3 py-1.5 text-sm sm:min-h-0',
        size === 'md' && 'min-h-11 px-4 py-2 text-sm sm:min-h-0',
        size === 'lg' && 'min-h-12 px-6 py-3 text-base sm:min-h-0',
        variant === 'primary' && 'bg-brand-600 text-white hover:bg-brand-700',
        variant === 'secondary' &&
          'border border-ink-200 bg-white text-ink-800 hover:bg-ink-50',
        variant === 'ghost' && 'text-ink-600 hover:bg-ink-100',
        className,
      )}
      {...props}
    />
  )
}

/**
 * 数据新鲜度标记(PRD 4.2 红线)。
 * 未核对 / 超 30 天未核对的数据必须在 UI 上明示,不能让用户误以为是确定值。
 */
export function FreshnessBadge({
  freshness,
  label,
}: {
  freshness: 'fresh' | 'stale' | 'unverified'
  label: string
}) {
  if (freshness === 'fresh') return null
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs',
        freshness === 'unverified' && 'bg-ink-100 text-ink-600',
        freshness === 'stale' && 'bg-amber-50 text-amber-700',
      )}
      title={label}
    >
      ⚠ {label}
    </span>
  )
}

/** 免责声明 —— 任何展示预估概率的地方都必须带上(PRD 10.1) */
export function Disclaimer({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg bg-ink-100 px-3 py-2 text-xs leading-relaxed text-ink-600">
      {children}
    </p>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-800">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-400">{hint}</span>}
    </label>
  )
}

export function RadioGroup<T extends string>({
  options,
  value,
  onChange,
  columns = 2,
}: {
  options: Array<{ value: T; label: string; description?: string }>
  value: T | null
  onChange: (v: T) => void
  columns?: 1 | 2
}) {
  return (
    <div className={cn('grid gap-2', columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1')}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            // min-h-11:移动端触控目标下限
            'min-h-11 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
            value === o.value
              ? 'border-brand-500 bg-brand-50 text-brand-700'
              : 'border-ink-200 bg-white text-ink-600 hover:border-ink-400',
          )}
        >
          <span className="block leading-snug">{o.label}</span>
          {o.description && (
            <span
              className={cn(
                'mt-1 block text-xs leading-snug',
                value === o.value ? 'text-brand-500' : 'text-ink-400',
              )}
            >
              {o.description}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
