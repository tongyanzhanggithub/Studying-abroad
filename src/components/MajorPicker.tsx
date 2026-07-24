'use client'

import { useMemo, useState } from 'react'
import { UNDERGRAD_DISCIPLINES } from '@/lib/programs/undergrad-catalog'

/**
 * 本科专业选择器 —— 基于《普通高等学校本科专业目录》的 12 学科门类 + 专业类。
 *
 * ── 为什么换掉原来的 18 个海外分类 ──────────────────────
 * 原来那 18 个是按海外院校 subject area 拼的(Business & Management…),
 * 国内学生对着找不到自己的专业。现在用国标目录:先选门类(12 个),
 * 再从门类下的专业类里挑,或直接搜关键词。哪个专业都对得上。
 *
 * 存进 undergradMajor 的是**专业类名**(如「金融学类」),
 * 方向推荐时由 undergrad-catalog 反查所属门类。
 */

const OTHER = '其他 / 跨学科'

// 专业类名 → 门类名,搜索时给个上下文
const CAT_TO_DISCIPLINE = new Map<string, string>()
for (const d of UNDERGRAD_DISCIPLINES) {
  for (const c of d.categories) CAT_TO_DISCIPLINE.set(c.name, d.name)
}

export function MajorPicker({
  value,
  onChange,
}: {
  value: string | null
  onChange: (v: string) => void
}) {
  const [q, setQ] = useState('')
  // 当前展开的门类;value 已选时默认展开它所属的门类
  const [openCode, setOpenCode] = useState<string | null>(() => {
    if (!value) return null
    const d = UNDERGRAD_DISCIPLINES.find(
      (x) => x.name === value || x.categories.some((c) => c.name === value),
    )
    return d?.code ?? null
  })

  const query = q.trim()
  const matches = useMemo(() => {
    if (!query) return []
    const out: Array<{ cat: string; discipline: string }> = []
    for (const d of UNDERGRAD_DISCIPLINES) {
      for (const c of d.categories) {
        if (c.name.includes(query) || d.name.includes(query)) {
          out.push({ cat: c.name, discipline: d.name })
        }
      }
    }
    return out.slice(0, 24)
  }, [query])

  const chip = (label: string, selected: boolean, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
        selected
          ? 'border-insta-pink bg-brand-50 font-medium text-brand-700'
          : 'border-ink-200 text-ink-700 hover:border-insta-pink hover:bg-brand-50/40'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-3">
      {/* 已选提示 */}
      {value && (
        <p className="rounded-lg bg-brand-50/70 px-3 py-2 text-xs text-brand-700">
          已选:<strong>{value}</strong>
          {CAT_TO_DISCIPLINE.get(value) && (
            <span className="text-brand-500">（{CAT_TO_DISCIPLINE.get(value)}门类）</span>
          )}
        </p>
      )}

      {/* 搜索 */}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜专业,如「金融」「计算机」「临床医学」"
        className="w-full rounded-lg border border-ink-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
      />

      {query ? (
        // ── 搜索结果 ──
        matches.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {matches.map((m) => (
              <button
                key={m.cat}
                type="button"
                onClick={() => {
                  onChange(m.cat)
                  setQ('')
                }}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  value === m.cat
                    ? 'border-insta-pink bg-brand-50 font-medium text-brand-700'
                    : 'border-ink-200 text-ink-700 hover:border-insta-pink hover:bg-brand-50/40'
                }`}
              >
                {m.cat}
                <span className="ml-1 text-xs text-ink-400">· {m.discipline}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="rounded-lg bg-ink-50 px-3 py-3 text-sm text-ink-500">
            没找到「{query}」。可以换个词,或直接在下面按门类选;实在没有就选「{OTHER}」。
          </p>
        )
      ) : (
        // ── 两级浏览:门类 → 专业类 ──
        <>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {UNDERGRAD_DISCIPLINES.map((d) => {
              const active = openCode === d.code
              const hasSelected =
                value === d.name || d.categories.some((c) => c.name === value)
              return (
                <button
                  key={d.code}
                  type="button"
                  onClick={() => setOpenCode(active ? null : d.code)}
                  className={`rounded-lg border px-2 py-2.5 text-center text-sm transition-colors ${
                    active
                      ? 'border-insta-pink bg-brand-50 font-medium text-brand-700'
                      : hasSelected
                        ? 'border-brand-200 bg-brand-50/50 text-brand-700'
                        : 'border-ink-200 text-ink-700 hover:border-insta-pink hover:bg-brand-50/40'
                  }`}
                >
                  {d.name}
                </button>
              )
            })}
          </div>

          {openCode && (
            <div className="rounded-lg border border-brand-100 bg-brand-50/30 p-3">
              {(() => {
                const d = UNDERGRAD_DISCIPLINES.find((x) => x.code === openCode)!
                return (
                  <>
                    <p className="mb-2 text-xs text-ink-500">
                      {d.name}门类下的专业类,选一个最接近你专业的:
                    </p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {d.categories.map((c) =>
                        chip(c.name, value === c.name, () => onChange(c.name)),
                      )}
                    </div>
                  </>
                )
              })()}
            </div>
          )}
        </>
      )}

      <button
        type="button"
        onClick={() => onChange(OTHER)}
        className={`text-xs ${
          value === OTHER ? 'font-medium text-brand-700' : 'text-ink-400 hover:text-ink-700'
        }`}
      >
        我的专业跨学科 / 不在目录里 →
      </button>
    </div>
  )
}
