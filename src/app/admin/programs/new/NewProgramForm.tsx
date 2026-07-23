'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button, Field } from '@/components/ui'
import {
  REGION_LABEL,
  REGION_ORDER,
  DIRECTION_LABEL,
  DIRECTION_ORDER,
} from '@/lib/programs/types'
import { createProgram } from './actions'

const EMPTY = {
  schoolNameEn: '',
  schoolNameZh: '',
  region: '',
  nameEn: '',
  nameZh: '',
  direction: '',
  sourceUrl: '',
}

export function NewProgramForm() {
  const router = useRouter()
  const [f, setF] = useState(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [dupId, setDupId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const set = (k: keyof typeof EMPTY, v: string) => setF((p) => ({ ...p, [k]: v }))

  const canSubmit =
    f.schoolNameEn.trim() && f.nameEn.trim() && f.region && f.direction && !pending

  function submit() {
    setError(null)
    setDupId(null)
    startTransition(async () => {
      const res = await createProgram(f)
      if (!res.ok) {
        setError(res.error)
        setDupId('existingId' in res ? (res.existingId ?? null) : null)
        return
      }
      // 建完直接进详情页继续补录取要求、截止日等 —— 那张表单更全
      router.push(`/admin/programs/${res.programId}`)
    })
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-ink-100 bg-white p-5">
        <h2 className="text-sm font-semibold text-ink-900">学校</h2>
        <p className="mt-1 mb-4 text-xs leading-relaxed text-ink-500">
          按「英文名 + 地区」识别。学校已存在会自动复用,不会重复创建,也不会改动它已有的信息。
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="学校英文名 *">
            <input
              value={f.schoolNameEn}
              onChange={(e) => set('schoolNameEn', e.target.value)}
              placeholder="University of Bath"
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </Field>
          <Field label="学校中文名">
            <input
              value={f.schoolNameZh}
              onChange={(e) => set('schoolNameZh', e.target.value)}
              placeholder="巴斯大学"
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </Field>
          <Field label="地区 *">
            <select
              value={f.region}
              onChange={(e) => set('region', e.target.value)}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
            >
              <option value="">请选择</option>
              {REGION_ORDER.map((r) => (
                <option key={r} value={r}>
                  {REGION_LABEL[r] ?? r}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <div className="rounded-xl border border-ink-100 bg-white p-5">
        <h2 className="text-sm font-semibold text-ink-900">项目</h2>
        <p className="mt-1 mb-4 text-xs leading-relaxed text-ink-500">
          同一学校下项目英文名不可重复。录取要求、学费、截止日等在下一步的详情页里填。
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="项目英文名 *">
            <input
              value={f.nameEn}
              onChange={(e) => set('nameEn', e.target.value)}
              placeholder="MSc Finance"
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </Field>
          <Field label="项目中文名">
            <input
              value={f.nameZh}
              onChange={(e) => set('nameZh', e.target.value)}
              placeholder="金融学理学硕士"
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </Field>
          <Field label="申请方向 *">
            <select
              value={f.direction}
              onChange={(e) => set('direction', e.target.value)}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
            >
              <option value="">请选择</option>
              {DIRECTION_ORDER.map((d) => (
                <option key={d} value={d}>
                  {DIRECTION_LABEL[d] ?? d}
                </option>
              ))}
            </select>
          </Field>
          <Field label="官网来源链接">
            <input
              value={f.sourceUrl}
              onChange={(e) => set('sourceUrl', e.target.value)}
              placeholder="https://…"
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </Field>
        </div>
      </div>

      <div className="rounded-lg bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
        新建的项目一律进「<strong>待核对</strong>」队列,不会立刻展示给学生 ——
        哪怕是你照着官网亲手敲的。请在详情页确认无误后点「标记已核对」,
        那一步会记下核对人和时间。少了它,「已核对」这个状态就没有意义了。
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          {dupId && (
            <Link href={`/admin/programs/${dupId}`} className="ml-2 underline">
              去编辑那一条 →
            </Link>
          )}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button disabled={!canSubmit} onClick={submit}>
          {pending ? '创建中…' : '创建并继续填写'}
        </Button>
        <Link href="/admin/programs" className="text-sm text-ink-500 hover:text-ink-900">
          取消
        </Link>
      </div>
    </div>
  )
}
