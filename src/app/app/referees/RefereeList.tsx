'use client'

import { useState, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, Button } from '@/components/ui'
import { cn } from '@/lib/utils'
import {
  createReferee,
  updateReferee,
  setRefereeStatus,
  deleteReferee,
  saveRefereeAnswer,
  generatePacket,
} from './actions'
import type { RefereeQuestionGroup } from '@/lib/essays/referee-questions'
import type { RefereeStatus, RefereeType } from '@prisma/client'

const TYPE_LABEL: Record<RefereeType, string> = {
  academic: '学术推荐人',
  professional: '职业推荐人',
}

/**
 * 进度不是「完成度」,是**处境**。
 * 每一档对应一个不同的下一步动作 —— 这正是它不做成 bool 的原因。
 */
const STATUS: Array<{ v: RefereeStatus; label: string; next: string; cls: string }> = [
  { v: 'draft', label: '还没联系', next: '先发邮件问对方愿不愿意', cls: 'bg-ink-100 text-ink-600' },
  { v: 'invited', label: '已发出邀请', next: '等回复。超过一周没动静就该跟进', cls: 'bg-amber-50 text-amber-700' },
  { v: 'agreed', label: '已答应', next: '把素材包发给他,并说明截止日期', cls: 'bg-brand-50 text-brand-700' },
  { v: 'submitted', label: '已提交', next: '这一封搞定了', cls: 'bg-safe/10 text-safe' },
  { v: 'declined', label: '婉拒了', next: '尽快换人 —— 别一直等一个不会来的回复', cls: 'bg-red-50 text-red-700' },
]

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function AnswerBox({
  refereeId,
  q,
  initial,
}: {
  refereeId: string
  q: { id: string; q: string; hint?: string; core?: boolean; long?: boolean }
  initial: string
}) {
  const [value, setValue] = useState(initial)
  const [state, setState] = useState<SaveState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [, startTransition] = useTransition()

  return (
    <div className="border-t border-ink-100 py-3 first:border-t-0 first:pt-0">
      <p className="text-sm font-medium text-ink-900">
        {q.q}
        {!q.core && <span className="ml-2 text-xs font-normal text-ink-400">选答</span>}
      </p>
      {q.hint && <p className="mt-1 text-xs leading-relaxed text-ink-500">{q.hint}</p>}
      <textarea
        value={value}
        rows={q.long ? 3 : 1}
        onChange={(e) => {
          const next = e.target.value
          setValue(next)
          if (timer.current) clearTimeout(timer.current)
          setState('saving')
          timer.current = setTimeout(() => {
            startTransition(async () => {
              const r = await saveRefereeAnswer(refereeId, q.id, next).catch(() => null)
              setState(r?.ok ? 'saved' : 'error')
            })
          }, 1200)
        }}
        className="mt-2 w-full resize-y rounded-lg border border-ink-200 px-3 py-2 text-sm leading-relaxed outline-none focus:border-brand-500"
      />
      <div className="h-4 text-xs">
        {state === 'saving' && <span className="text-ink-400">保存中…</span>}
        {state === 'saved' && <span className="text-ink-400">已保存</span>}
        {state === 'error' && (
          <span className="font-medium text-red-600">没保存上 —— 先复制一份再刷新</span>
        )}
      </div>
    </div>
  )
}

export interface RefereeItem {
  id: string
  name: string
  title: string | null
  department: string | null
  institution: string | null
  email: string | null
  phone: string | null
  note: string | null
  type: RefereeType
  status: RefereeStatus
  invitedAt: string | null
  groups: RefereeQuestionGroup[]
  answers: Record<string, string>
  progress: { done: number; total: number; percent: number }
}

function RefereeCard({ item }: { item: RefereeItem }) {
  const router = useRouter()
  const [tab, setTab] = useState<'material' | 'contact' | null>(null)
  const [packet, setPacket] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [, startTransition] = useTransition()

  const meta = STATUS.find((s) => s.v === item.status) ?? STATUS[0]

  /**
   * 「问了多久了」—— 这是催或换人的唯一依据。
   * 超过 7 天没回复就该跟进,超过 14 天该考虑换人。
   */
  const waitingDays =
    item.status === 'invited' && item.invitedAt
      ? Math.floor((Date.now() - new Date(item.invitedAt).getTime()) / 86_400_000)
      : null

  return (
    <Card className="p-0">
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-ink-900">
              {item.name}
              {item.title && <span className="ml-1 text-sm text-ink-500">{item.title}</span>}
            </p>
            <p className="mt-0.5 text-xs text-ink-400">
              {TYPE_LABEL[item.type]}
              {item.institution && ` · ${item.institution}`}
              {item.department && ` · ${item.department}`}
            </p>
          </div>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', meta.cls)}>
            {meta.label}
          </span>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-ink-500">
          下一步:{meta.next}
          {waitingDays !== null && waitingDays >= 7 && (
            <span className="ml-1 font-medium text-amber-700">
              (已经等了 {waitingDays} 天{waitingDays >= 14 ? ',建议考虑换人' : ',可以催一下'})
            </span>
          )}
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {STATUS.map((s) => (
            <button
              key={s.v}
              onClick={() =>
                startTransition(async () => {
                  await setRefereeStatus(item.id, s.v)
                  router.refresh()
                })
              }
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs transition-colors',
                item.status === s.v
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-ink-200 text-ink-500 hover:border-brand-300',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <button
            onClick={() => setTab(tab === 'material' ? null : 'material')}
            className="text-brand-600 hover:underline"
          >
            素材 {item.progress.done}/{item.progress.total}
          </button>
          <button
            onClick={() => setTab(tab === 'contact' ? null : 'contact')}
            className="text-brand-600 hover:underline"
          >
            联系方式
          </button>
          <button
            onClick={() =>
              startTransition(async () => {
                const r = await generatePacket(item.id)
                setPacket(r.ok ? r.text : `生成失败:${r.error}`)
                setCopied(false)
              })
            }
            className="text-brand-600 hover:underline"
          >
            生成素材包
          </button>
          <button
            onClick={() => {
              if (!confirm(`删除推荐人「${item.name}」?已填的素材会一起删掉。`)) return
              startTransition(async () => {
                await deleteReferee(item.id)
                router.refresh()
              })
            }}
            className="ml-auto text-ink-400 hover:text-red-600"
          >
            删除
          </button>
        </div>
      </div>

      {tab === 'contact' && (
        <div className="grid gap-3 border-t border-ink-100 px-4 py-4 sm:grid-cols-2">
          {(
            [
              ['title', '职称', '如:副教授'],
              ['institution', '单位', '如:四川师范大学'],
              ['department', '院系', '如:法学院'],
              ['email', '邮箱', '优先用学校后缀邮箱'],
              ['phone', '手机', ''],
            ] as const
          ).map(([field, label, ph]) => (
            <label key={field} className="text-sm">
              <span className="text-xs text-ink-500">{label}</span>
              <input
                defaultValue={item[field] ?? ''}
                placeholder={ph}
                onBlur={(e) =>
                  startTransition(async () => {
                    await updateReferee(item.id, { [field]: e.target.value })
                    router.refresh()
                  })
                }
                className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 outline-none focus:border-brand-500"
              />
            </label>
          ))}
          <p className="text-xs leading-relaxed text-ink-400 sm:col-span-2">
            {/* 这是真实第三方的个人信息,得说清楚我们怎么处理 */}
            这些是推荐人的个人信息,只用于你自己填写网申表格,不会发给任何第三方,
            注销账号时一并删除。
          </p>
        </div>
      )}

      {tab === 'material' && (
        <div className="space-y-4 border-t border-ink-100 px-4 py-4">
          {item.groups.map((g) => (
            <div key={g.id}>
              <p className="text-sm font-medium text-ink-900">{g.title}</p>
              <p className="mt-0.5 mb-2 text-xs leading-relaxed text-ink-500">{g.why}</p>
              {g.questions.map((q) => (
                <AnswerBox
                  key={q.id}
                  refereeId={item.id}
                  q={q}
                  initial={item.answers[q.id] ?? ''}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {packet && (
        <div className="border-t border-ink-100 px-4 py-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-ink-900">给推荐人的素材(复制后发给他)</p>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(packet).then(() => setCopied(true))
              }}
              className="text-sm text-brand-600 hover:underline"
            >
              {copied ? '已复制' : '复制全文'}
            </button>
          </div>
          <textarea
            readOnly
            value={packet}
            rows={14}
            className="w-full resize-y rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 font-mono text-xs leading-relaxed"
          />
          <p className="mt-2 text-xs leading-relaxed text-ink-500">
            这是<strong className="text-ink-700">事实清单</strong>,不是推荐信草稿 —— 信由推荐人自己写。
            建议连同你的 CV 和成绩单一起发过去。
          </p>
        </div>
      )}
    </Card>
  )
}

export function RefereeList({ items }: { items: RefereeItem[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [type, setType] = useState<RefereeType>('academic')
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  return (
    <div className="space-y-3">
      {items.map((it) => (
        <RefereeCard key={it.id} item={it} />
      ))}

      <Card>
        <p className="mb-2 text-sm font-medium text-ink-900">添加推荐人</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="推荐人姓名"
            className="min-w-40 flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value as RefereeType)}
            className="rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
          >
            <option value="academic">学术推荐人</option>
            <option value="professional">职业推荐人</option>
          </select>
          <Button
            onClick={() =>
              startTransition(async () => {
                const r = await createReferee({ name, type })
                if (r.ok) {
                  setName('')
                  setError(null)
                  router.refresh()
                } else {
                  setError(r.error)
                }
              })
            }
          >
            添加
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <p className="mt-2 text-xs leading-relaxed text-ink-400">
          学术推荐人问的是课程、分数和你在课上做过的事;职业推荐人问的是岗位、项目和工作表现。
        </p>
      </Card>
    </div>
  )
}
