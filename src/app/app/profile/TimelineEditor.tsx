'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, Button } from '@/components/ui'
import { cn } from '@/lib/utils'
import { formatRange, type TimelineGap } from '@/lib/profile/timeline'
import { saveTimelineEntry, deleteTimelineEntry, savePassportName } from './actions'
import type { TimelineKind } from '@prisma/client'

const KIND_LABEL: Record<TimelineKind, string> = {
  education: '就读',
  work: '工作 / 实习',
  other: '其他',
}
const KIND_CLS: Record<TimelineKind, string> = {
  education: 'bg-brand-50 text-brand-700',
  work: 'bg-safe/10 text-safe',
  other: 'bg-ink-100 text-ink-600',
}

export interface EntryItem {
  id: string
  kind: TimelineKind
  startYm: string
  endYm: string | null
  organization: string
  role: string | null
  description: string | null
}

const EMPTY = {
  id: '',
  kind: 'education' as TimelineKind,
  startYm: '',
  endYm: '',
  organization: '',
  role: '',
  description: '',
}

function EntryForm({
  initial,
  onDone,
  onCancel,
}: {
  initial: typeof EMPTY
  onDone: () => void
  onCancel?: () => void
}) {
  const router = useRouter()
  const [form, setForm] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const set = (k: keyof typeof EMPTY, v: string) => setForm({ ...form, [k]: v })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(KIND_LABEL) as TimelineKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => set('kind', k)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              form.kind === k
                ? 'border-brand-500 bg-brand-50 text-brand-700'
                : 'border-ink-200 text-ink-500 hover:border-brand-300',
            )}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-xs text-ink-500">开始(年-月)</span>
          <input
            value={form.startYm}
            onChange={(e) => set('startYm', e.target.value)}
            placeholder="2020-09"
            className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 outline-none focus:border-brand-500"
          />
        </label>
        <label className="text-sm">
          <span className="text-xs text-ink-500">结束(留空 = 至今)</span>
          <input
            value={form.endYm}
            onChange={(e) => set('endYm', e.target.value)}
            placeholder="2024-06"
            className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 outline-none focus:border-brand-500"
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="text-xs text-ink-500">
          {form.kind === 'education' ? '学校全称' : form.kind === 'work' ? '单位全称' : '说明'}
          {/* 网申表格明确要求全称,写简称会被要求补件 */}
          <span className="ml-1 text-ink-400">(网申要求填全称,别写简称)</span>
        </span>
        <input
          value={form.organization}
          onChange={(e) => set('organization', e.target.value)}
          placeholder={
            form.kind === 'education'
              ? '北京工商大学'
              : form.kind === 'work'
                ? '某某科技有限公司'
                : '如:全职备考雅思'
          }
          className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 outline-none focus:border-brand-500"
        />
      </label>

      <label className="block text-sm">
        <span className="text-xs text-ink-500">
          {form.kind === 'education' ? '专业 / 学位' : '职位'}
        </span>
        <input
          value={form.role}
          onChange={(e) => set('role', e.target.value)}
          placeholder={form.kind === 'education' ? '金融学 · 本科' : '数据分析实习生'}
          className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 outline-none focus:border-brand-500"
        />
      </label>

      <label className="block text-sm">
        <span className="text-xs text-ink-500">补充说明(选填)</span>
        <textarea
          value={form.description}
          rows={2}
          onChange={(e) => set('description', e.target.value)}
          className="mt-1 w-full resize-y rounded-lg border border-ink-200 px-3 py-2 outline-none focus:border-brand-500"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <Button
          onClick={() =>
            startTransition(async () => {
              const r = await saveTimelineEntry({ ...form, id: form.id || undefined })
              if (r.ok) {
                setError(null)
                setForm(EMPTY)
                onDone()
                router.refresh()
              } else {
                setError(r.error)
              }
            })
          }
        >
          保存
        </Button>
        {onCancel && (
          <button onClick={onCancel} className="text-sm text-ink-500 hover:text-ink-800">
            取消
          </button>
        )}
      </div>
    </div>
  )
}

export function TimelineEditor({
  entries,
  gaps,
  passportSurname,
  passportGivenName,
}: {
  entries: EntryItem[]
  gaps: TimelineGap[]
  passportSurname: string | null
  passportGivenName: string | null
}) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [surname, setSurname] = useState(passportSurname ?? '')
  const [given, setGiven] = useState(passportGivenName ?? '')
  const [, startTransition] = useTransition()

  const saveName = () =>
    startTransition(async () => {
      await savePassportName({ surname, givenName: given })
      router.refresh()
    })

  return (
    <div className="space-y-5">
      {/* ── 护照拼音 ── */}
      <Card>
        <p className="font-medium text-ink-900">护照姓名拼音</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">
          {/* ⚠️ JSX 文本里不能写 markdown 的 **,星号会原样显示 —— 加粗用 <strong> */}
          成绩单、在读证明、推荐信、网申账号必须用<strong>同一个</strong>拼法。不一致的话学校会当成
          两个人,轻则补件、重则影响签证。以护照上印的为准,这里存一份,其他地方照着填。
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-sm">
            <span className="text-xs text-ink-500">姓(Surname)</span>
            <input
              value={surname}
              onChange={(e) => setSurname(e.target.value)}
              onBlur={saveName}
              placeholder="ZHANG"
              className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 font-mono uppercase outline-none focus:border-brand-500"
            />
          </label>
          <label className="text-sm">
            <span className="text-xs text-ink-500">名(Given name)</span>
            <input
              value={given}
              onChange={(e) => setGiven(e.target.value)}
              onBlur={saveName}
              placeholder="SAN"
              className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 font-mono uppercase outline-none focus:border-brand-500"
            />
          </label>
        </div>
      </Card>

      {/* ── 空档提示 ── */}
      {gaps.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm font-medium text-amber-900">
            时间轴上有 {gaps.length} 处空档需要说明
          </p>
          <ul className="mt-2 space-y-1 text-sm leading-relaxed text-amber-900">
            {gaps.map((g) => (
              <li key={`${g.from}-${g.to}`}>
                · {formatRange(g.from, g.to)}(约 {g.months} 个月)
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-amber-800">
            {/*
              这是这一页相对纸质表格唯一真正的增量:空档是算出来的,不用人自己对日期。
              但要说清楚「有空档不是问题,说不清楚才是」,否则纯属制造焦虑(PRD 14)。
            */}
            海外网申普遍要求经历连续、空档要能解释。<strong>有空档本身不是问题</strong>,
            说不清楚才是 —— 备考、实习、待业、生病都可以,用「其他」补一条写清楚就行。
          </p>
        </Card>
      )}

      {/* ── 时间轴 ── */}
      <div className="space-y-2">
        {entries.map((e) =>
          editId === e.id ? (
            <Card key={e.id}>
              <EntryForm
                initial={{
                  id: e.id,
                  kind: e.kind,
                  startYm: e.startYm,
                  endYm: e.endYm ?? '',
                  organization: e.organization,
                  role: e.role ?? '',
                  description: e.description ?? '',
                }}
                onDone={() => setEditId(null)}
                onCancel={() => setEditId(null)}
              />
            </Card>
          ) : (
            <Card key={e.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                        KIND_CLS[e.kind],
                      )}
                    >
                      {KIND_LABEL[e.kind]}
                    </span>
                    <span className="text-xs text-ink-400">
                      {formatRange(e.startYm, e.endYm)}
                    </span>
                  </div>
                  <p className="mt-1 font-medium text-ink-900">{e.organization}</p>
                  {e.role && <p className="text-sm text-ink-600">{e.role}</p>}
                  {e.description && (
                    <p className="mt-1 text-xs leading-relaxed text-ink-500">{e.description}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-3 text-sm">
                  <button
                    onClick={() => setEditId(e.id)}
                    className="text-brand-600 hover:underline"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() =>
                      startTransition(async () => {
                        await deleteTimelineEntry(e.id)
                        router.refresh()
                      })
                    }
                    className="text-ink-400 hover:text-red-600"
                  >
                    删除
                  </button>
                </div>
              </div>
            </Card>
          ),
        )}
      </div>

      {adding ? (
        <Card>
          <p className="mb-3 font-medium text-ink-900">添加一段经历</p>
          <EntryForm initial={EMPTY} onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
        </Card>
      ) : (
        <Button onClick={() => setAdding(true)}>添加经历</Button>
      )}
    </div>
  )
}
