'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { logout } from '@/app/login/actions'

/**
 * 移动端底部标签栏。
 *
 * 之前手机上是 8 个入口横向滚动 —— 得左右划才够得着,拇指也难点准。
 * 留学生大量用手机,底部固定 Tab 是这个场景的标准解:4 个高频直达 + 「更多」。
 * 桌面端隐藏(sm:hidden),桌面走顶部导航。
 */

const TABS = [
  { href: '/app/dashboard', label: '总览', icon: HomeIcon },
  { href: '/app/schools', label: '选校', icon: SchoolIcon },
  { href: '/app/materials', label: '材料', icon: DocIcon },
  { href: '/app/essays', label: '文书', icon: PenIcon },
]

const MORE = [
  { href: '/app/assessments', label: '评估方案' },
  { href: '/app/services', label: '人工服务' },
  { href: '/app/orders', label: '我的订单' },
  { href: '/app/settings', label: '账号设置' },
]

export function MobileTabBar() {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')
  const moreActive = MORE.some((m) => isActive(m.href))

  return (
    <>
      {/* 底部占位,避免内容被固定栏遮住 */}
      <div className="h-16 sm:hidden" aria-hidden />

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-100 bg-white/95 backdrop-blur sm:hidden">
        <div className="mx-auto flex max-w-md items-stretch">
          {TABS.map((t) => {
            const active = isActive(t.href)
            const Icon = t.icon
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
                  active ? 'text-brand-600' : 'text-ink-400'
                }`}
              >
                <Icon active={active} />
                {t.label}
              </Link>
            )
          })}
          <button
            onClick={() => setMoreOpen(true)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
              moreActive ? 'text-brand-600' : 'text-ink-400'
            }`}
          >
            <MoreIcon active={moreActive} />
            更多
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 sm:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-4 pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink-200" />
            <div className="grid grid-cols-2 gap-2">
              {MORE.map((m) => (
                <Link
                  key={m.href}
                  href={m.href}
                  onClick={() => setMoreOpen(false)}
                  className={`rounded-xl border px-4 py-3 text-sm ${
                    isActive(m.href)
                      ? 'border-brand-200 bg-brand-50 text-brand-700'
                      : 'border-ink-100 text-ink-700'
                  }`}
                >
                  {m.label}
                </Link>
              ))}
            </div>
            <form action={logout} className="mt-3">
              <button className="w-full rounded-xl border border-ink-100 py-3 text-sm text-ink-500">
                退出登录
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

// ── 极简图标(线性,active 时随文字变色)────────────────
function base(active: boolean) {
  return {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: active ? 2.2 : 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
}
function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg {...base(active)}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  )
}
function SchoolIcon({ active }: { active: boolean }) {
  return (
    <svg {...base(active)}>
      <path d="M12 3 2 8l10 5 10-5-10-5Z" />
      <path d="M6 10.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-5.5" />
    </svg>
  )
}
function DocIcon({ active }: { active: boolean }) {
  return (
    <svg {...base(active)}>
      <path d="M6 2h8l4 4v16H6V2Z" />
      <path d="M14 2v4h4M9 13h6M9 17h6" />
    </svg>
  )
}
function PenIcon({ active }: { active: boolean }) {
  return (
    <svg {...base(active)}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </svg>
  )
}
function MoreIcon({ active }: { active: boolean }) {
  return (
    <svg {...base(active)}>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </svg>
  )
}
