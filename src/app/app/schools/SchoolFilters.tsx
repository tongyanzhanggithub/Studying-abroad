'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

type Opt = { value: string; label: string }

const SORT_OPTIONS: Opt[] = [
  { value: 'default', label: '默认排序' },
  { value: 'deadline', label: '最近截止优先' },
  { value: 'overall_rank', label: '综合排名优先' },
  { value: 'subject_rank', label: '专业排名优先' },
]

/**
 * 院校库筛选栏。
 *
 * 改之前是一整行挤了「搜索框 + 4 个长得一样的灰色下拉 + 筛选按钮」——
 * 6 个控件平铺,谁也不比谁显眼,扫一眼很累,也看不出哪些筛选正生效。
 *
 * 现在拆成三层,主次分明:
 *   1. 搜索框独占主行(最常用),旁边一个「筛选」开关。
 *   2. 地区/方向/排名/排序收进折叠面板,默认收起,不再一上来就糊一脸。
 *   3. 已生效的筛选做成一排可点掉的 chip —— 面板收起时也看得见、随手能撤,
 *      功能没被藏起来。
 *
 * 仍是原生 GET 表单:没 JS 也能搜、能筛,折叠只是锦上添花。
 */
export function SchoolFilters({
  q,
  region,
  direction,
  rankingProvider,
  sort,
  regionOptions,
  directionOptions,
  rankingOptions,
}: {
  q?: string
  region?: string
  direction?: string
  rankingProvider?: string
  sort: string
  regionOptions: Opt[]
  directionOptions: Opt[]
  rankingOptions: Opt[]
}) {
  // 已生效的筛选(不含搜索词和「默认排序」)—— 决定 chip 和角标数字
  const active: { key: string; label: string }[] = []
  if (region)
    active.push({ key: 'region', label: regionOptions.find((o) => o.value === region)?.label ?? region })
  if (direction)
    active.push({ key: 'direction', label: directionOptions.find((o) => o.value === direction)?.label ?? direction })
  if (rankingProvider)
    active.push({
      key: 'rankingProvider',
      label: `排名·${rankingOptions.find((o) => o.value === rankingProvider)?.label ?? rankingProvider}`,
    })
  if (sort && sort !== 'default')
    active.push({ key: 'sort', label: SORT_OPTIONS.find((o) => o.value === sort)?.label ?? sort })

  // 面板默认收起;但如果已经带着筛选进来,就默认展开,免得用户以为筛选丢了
  const [open, setOpen] = useState(active.length > 0)

  // 去掉某一个筛选、保留其余(含搜索词)的链接 —— chip 的 × 用它
  const hrefWithout = (dropKey: string) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (region && dropKey !== 'region') params.set('region', region)
    if (direction && dropKey !== 'direction') params.set('direction', direction)
    if (rankingProvider && dropKey !== 'rankingProvider') params.set('rankingProvider', rankingProvider)
    if (sort && sort !== 'default' && dropKey !== 'sort') params.set('sort', sort)
    const s = params.toString()
    return s ? `/app/schools?${s}` : '/app/schools'
  }

  // 清除全部筛选,但保留搜索词
  const clearHref = q ? `/app/schools?q=${encodeURIComponent(q)}` : '/app/schools'

  const selectCls =
    'min-h-10 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-700 outline-none focus:border-brand-500'

  return (
    <div className="mb-4">
      <form action="/app/schools" className="flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="搜索院校或专业"
          className="min-w-0 flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />

        {/*
          收起时下拉框仍在表单里(只是视觉隐藏),因此点「搜索」会连带当前筛选一起提交,
          筛选不会因为面板没展开就丢掉。
        */}
        <button
          type="submit"
          className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700"
        >
          搜索
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-lg border px-3 py-2 text-sm',
            active.length > 0
              ? 'border-brand-200 bg-brand-50 text-brand-700'
              : 'border-ink-200 text-ink-600 hover:border-brand-500',
          )}
        >
          筛选
          {active.length > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-medium text-white">
              {active.length}
            </span>
          )}
          <span className={cn('text-xs transition-transform', open && 'rotate-180')}>⌄</span>
        </button>

        {/* 折叠面板:一行四个,带小标签,不再让人猜每个下拉是干嘛的 */}
        <div className={cn('order-last w-full', open ? 'block' : 'hidden')}>
          <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl border border-ink-100 bg-ink-50 p-3 sm:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-xs text-ink-500">地区</span>
              <select name="region" defaultValue={region ?? ''} className={selectCls}>
                <option value="">不限</option>
                {regionOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-ink-500">方向</span>
              <select name="direction" defaultValue={direction ?? ''} className={selectCls}>
                <option value="">不限</option>
                {directionOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-ink-500">排名体系</span>
              <select name="rankingProvider" defaultValue={rankingProvider ?? ''} className={selectCls}>
                <option value="">不看排名</option>
                {rankingOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-ink-500">排序</span>
              <select name="sort" defaultValue={sort} className={selectCls}>
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </form>

      {/* 已生效筛选:面板收起也看得见,× 一点即撤 */}
      {active.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {active.map((a) => (
            <Link
              key={a.key}
              href={hrefWithout(a.key)}
              className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs text-brand-700 hover:bg-brand-100"
            >
              {a.label}
              <span className="text-brand-400">×</span>
            </Link>
          ))}
          <Link href={clearHref} className="ml-1 text-xs text-ink-400 hover:text-ink-600">
            清除全部
          </Link>
        </div>
      )}
    </div>
  )
}
