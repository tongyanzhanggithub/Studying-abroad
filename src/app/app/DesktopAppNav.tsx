'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_GROUPS = [
  {
    title: '申请流程',
    items: [
      { href: '/app/dashboard', label: '总览', desc: '下一步该做什么', icon: HomeIcon },
      { href: '/app/assessments', label: '评估', desc: '申请地图与推荐', icon: MapIcon },
      { href: '/app/schools', label: '选校', desc: '院校库与名单', icon: SchoolIcon },
      { href: '/app/materials', label: '材料', desc: '共用材料清单', icon: DocIcon },
      { href: '/app/essays', label: '文书', desc: '素材与润色', icon: PenIcon },
    ],
  },
  {
    title: '账户与服务',
    items: [
      { href: '/app/services', label: '服务', desc: '人工服务加购', icon: ServiceIcon },
      { href: '/app/orders', label: '订单', desc: '支付与交付', icon: OrderIcon },
      { href: '/app/settings', label: '设置', desc: '资料与安全', icon: SettingsIcon },
    ],
  },
]

export function DesktopAppNav() {
  const pathname = usePathname()

  return (
    <aside className="hidden sm:block">
      <div className="sticky top-20 rounded-lg border border-ink-100 bg-white/86 p-3 shadow-[0_18px_42px_rgba(35,42,53,0.06)] backdrop-blur-xl">
        <div className="rounded-lg bg-[linear-gradient(135deg,rgba(255,247,251,0.96),rgba(246,251,255,0.96))] px-3 py-3">
          <p className="gradient-text text-xs font-semibold">WORKSPACE</p>
          <p className="mt-1 text-sm font-medium text-ink-900">申请工作台</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">选校、材料、文书和服务都在这里推进。</p>
        </div>

        <nav className="mt-4 space-y-5">
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="px-2 text-[11px] font-medium text-ink-400">{group.title}</p>
              <div className="mt-2 space-y-1">
                {group.items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(item.href + '/')
                  const Icon = item.icon

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                        active
                          ? 'border-brand-100 bg-brand-50 text-brand-700 shadow-[0_10px_24px_rgba(225,48,108,0.08)]'
                          : 'border-transparent text-ink-600 hover:border-ink-100 hover:bg-white'
                      }`}
                    >
                      <span
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                          active ? 'bg-white text-brand-600' : 'bg-ink-50 text-ink-400'
                        }`}
                        aria-hidden
                      >
                        <Icon active={active} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{item.label}</span>
                        <span className={`block truncate text-xs ${active ? 'text-brand-500' : 'text-ink-400'}`}>
                          {item.desc}
                        </span>
                      </span>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/*
          显式的返回首页入口。
          只靠左上角 logo 不够 —— 「点 logo 回首页」虽然是通用惯例,
          但工作台里 logo 不显眼,而定价、用户协议、隐私政策、FAQ 都在营销站上,
          用户想去看时得手动改地址栏。
        */}
        <div className="mt-5 border-t border-ink-100 pt-3">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-700"
          >
            <span aria-hidden>←</span>
            返回网站首页
          </Link>
        </div>
      </div>
    </aside>
  )
}

function iconProps(active: boolean) {
  return {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: active ? 2.3 : 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
}

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  )
}

function MapIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <path d="M8 18 3 20V6l5-2 8 2 5-2v14l-5 2-8-2Z" />
      <path d="M8 4v14M16 6v14" />
    </svg>
  )
}

function SchoolIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <path d="M12 3 2 8l10 5 10-5-10-5Z" />
      <path d="M6 10.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-5.5" />
    </svg>
  )
}

function DocIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <path d="M6 2h8l4 4v16H6V2Z" />
      <path d="M14 2v4h4M9 13h6M9 17h6" />
    </svg>
  )
}

function PenIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </svg>
  )
}

function ServiceIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <path d="M12 3 14.5 8l5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2l.9-5.5-4-3.9 5.5-.8L12 3Z" />
    </svg>
  )
}

function OrderIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <path d="M7 3h10v18l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2V3Z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </svg>
  )
}

function SettingsIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.9 3.2-.2-.1a1.7 1.7 0 0 0-2 .1 1.7 1.7 0 0 0-.8 1.7v.1H9.1v-.1a1.7 1.7 0 0 0-.8-1.7 1.7 1.7 0 0 0-2-.1l-.2.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.4-1.1H3v-3.8h.2A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9L4.2 7l1.9-3.2.2.1a1.7 1.7 0 0 0 2-.1 1.7 1.7 0 0 0 .8-1.7V2h5.8v.1a1.7 1.7 0 0 0 .8 1.7 1.7 1.7 0 0 0 2 .1l.2-.1L19.8 7l-.1.1A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.4 1.1h.2v3.8h-.2A1.7 1.7 0 0 0 19.4 15Z" />
    </svg>
  )
}
