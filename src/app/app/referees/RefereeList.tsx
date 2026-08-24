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
  generateInvite,
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
  { v: 'agreed', label: '已答应', next: '现在开始整理要给他的信息 —— 他记不住你哪次作业做得好,细节得你递过去', cls: 'bg-brand-50 text-brand-700' },
  { v: 'submitted', label: '已提交', next: '这一封搞定了', cls: 'bg-safe/10 text-safe' },
  { v: 'declined', label: '婉拒了', next: '尽快换人 —— 别一直等一个不会来的回复', cls: 'bg-red-50 text-red-700' },
]

/**
 * 每种处境下**唯一该做的那件事**。
 *
 * ⚠️ 改这一版之前,卡片上是 5 个状态胶囊 + 4 个文字按钮 —— 9 个同等分量的控件,
 *    没有一个是「现在该点的」。而卡片自己其实已经算出了下一步
 *    (STATUS[].next,「先发邮件问对方愿不愿意」),却只把它写成一句灰色小字。
 *
 *    也就是说:系统知道答案,却让用户在九个选项里自己找。
 *    这和这个产品在别处的做法是反的 —— 总览页的「现在最该做的」、
 *    派单页的「标记交付中 / 标记已交付」,都是一次只给一个动作。
 *
 * ⚠️ 五个状态胶囊没有删,收进「改状态」里了。
 *    它们是**改错时用的**,不是日常推进用的 —— 日常推进是单向的。
 */
type Primary =
  | { kind: 'status'; label: string; to: RefereeStatus }
  | { kind: 'invite'; label: string }
  | { kind: 'material'; label: string }
  | { kind: 'add'; label: string }
  | null

function primaryFor(status: RefereeStatus, materialDone: number, materialTotal: number): Primary {
  switch (status) {
    case 'draft':
      /**
       * ⚠️ 这一步原来是「我已经发邮件问过了」—— 一个**事后记账**的按钮。
       *    系统告诉你「下一步:先发邮件问对方愿不愿意」,却把最难的那步
       *    (怎么措辞)原样留给你,自己只负责打勾。
       *    改成直接把信给你,发完再标记。
       */
      return { kind: 'invite', label: '问他愿不愿意' }
    case 'invited':
      return { kind: 'status', label: '他答应了', to: 'agreed' }
    case 'agreed':
      /**
       * ⚠️ 素材一条没填就生成,产出的是一份只有骨架、没有事实的材料 ——
       *    发过去等于浪费老师一次注意力,而这一环最贵的就是这个。
       *    所以这一档先把人推回去填素材。
       */
      return materialDone === 0
        ? { kind: 'material', label: `开始整理要给他的信息(${materialDone}/${materialTotal})` }
        : { kind: 'status', label: '他已经提交了', to: 'submitted' }
    case 'submitted':
      return null
    case 'declined':
      return { kind: 'add', label: '换一位推荐人' }
  }
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/** 学生在素材库里已经写过的、和这道题相关的内容 */
export type StoryHint = { question: string; answer: string }

function AnswerBox({
  refereeId,
  q,
  initial,
}: {
  refereeId: string
  q: {
    id: string
    q: string
    hint?: string
    core?: boolean
    long?: boolean
    storyHints?: StoryHint[]
  }
  initial: string
}) {
  const [value, setValue] = useState(initial)
  const [state, setState] = useState<SaveState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [, startTransition] = useTransition()

  /** 立刻存,不走 1.2 秒防抖 —— 点「填入」是个明确动作,不是打字 */
  const saveNow = (next: string) => {
    setValue(next)
    if (timer.current) clearTimeout(timer.current)
    setState('saving')
    startTransition(async () => {
      const r = await saveRefereeAnswer(refereeId, q.id, next).catch(() => null)
      setState(r?.ok ? 'saved' : 'error')
    })
  }

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

      {/*
        素材库里写过的相关内容。
        ⚠️ 只在这一栏**还空着**的时候出现 —— 已经写了东西还在旁边挂个
           「填入」,那是在诱导覆盖自己刚写的。
        ⚠️ 是提示不是自动填:两边颗粒度不一样(素材库问整体成绩,
           这里问这门课的排名),搬错了就是让教授在信里写一个不准的数字。
           填不填、填完改不改,由学生自己定。
      */}
      {!value.trim() &&
        (q.storyHints ?? []).map((h) => (
          <div
            key={h.question}
            className="mt-1 rounded-lg border border-dashed border-brand-200 bg-brand-50/40 px-3 py-2"
          >
            <p className="text-xs leading-relaxed text-ink-500">
              你在素材库「{h.question}」下写过:
            </p>
            <p className="mt-1 text-xs leading-relaxed text-ink-700">{h.answer}</p>
            <button
              type="button"
              onClick={() => saveNow(h.answer)}
              className="mt-1.5 text-xs font-medium text-brand-600 hover:underline"
            >
              填入这一栏(填完可以改)
            </button>
          </div>
        ))}
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
  /**
   * ⚠️ 每道题带上素材库里的相关内容(storyHints)。
   *    刻意**不写成可选** —— 写成可选的话,page.tsx 里那段映射被删掉
   *    也不会报错,提示区就悄无声息地空了,而没人会发现。
   *    页面上没有可提示的内容时给空数组,不是 undefined。
   */
  groups: Array<
    Omit<RefereeQuestionGroup, 'questions'> & {
      questions: Array<RefereeQuestionGroup['questions'][number] & { storyHints: StoryHint[] }>
    }
  >
  answers: Record<string, string>
  progress: { done: number; total: number; percent: number }
}

function RefereeCard({ item }: { item: RefereeItem }) {
  const router = useRouter()
  const [tab, setTab] = useState<'material' | 'contact' | null>(null)
  // 五个状态胶囊默认收起 —— 它们是改错用的,不是日常推进用的
  const [editStatus, setEditStatus] = useState(false)
  const [, startTransition] = useTransition()

  const meta = STATUS.find((s) => s.v === item.status) ?? STATUS[0]
  const primary = primaryFor(item.status, item.progress.done, item.progress.total)

  const setStatus = (to: RefereeStatus) =>
    startTransition(async () => {
      await setRefereeStatus(item.id, to)
      setEditStatus(false)
      router.refresh()
    })

  const [invite, setInvite] = useState<string | null>(null)
  const [inviteCopied, setInviteCopied] = useState(false)

  const makeInvite = () =>
    startTransition(async () => {
      const r = await generateInvite(item.id)
      setInvite(r.ok ? r.text : `生成失败:${r.error}`)
      setInviteCopied(false)
    })

  /** 还没得到答复 —— 这之前收集信息有白做的风险 */
  const waitingAgreement = item.status === 'draft' || item.status === 'invited'

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

        {/* 一次只给一个动作 —— 见 primaryFor 的注释 */}
        {primary && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {primary.kind === 'add' ? (
              <a
                href="#add-referee"
                className="insta-button inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-white"
              >
                {primary.label}
              </a>
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  if (primary.kind === 'status') setStatus(primary.to)
                  else if (primary.kind === 'invite') makeInvite()
                  else setTab('material')
                }}
              >
                {primary.label}
              </Button>
            )}

            {/* 「他婉拒了」是另一条真实分支,不该藏进「改状态」里 */}
            {item.status === 'invited' && (
              <Button size="sm" variant="ghost" onClick={() => setStatus('declined')}>
                他婉拒了
              </Button>
            )}
          </div>
        )}

        <div className="mt-2">
          <button
            onClick={() => setEditStatus((v) => !v)}
            className="text-xs text-ink-400 hover:text-ink-700"
          >
            {editStatus ? '收起' : '改状态'}
          </button>
          {editStatus && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {STATUS.map((s) => (
                <button
                  key={s.v}
                  onClick={() => setStatus(s.v)}
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
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          {/*
            ⚠️ 顺序是:先确认他同意,同意了才收集信息。
               他还没答应就让人填 8 道题,填完人家婉拒了,这些字全白写 ——
               而推荐信这一环最常见的结果就是「问了三个,答应两个」。

               但**不禁用、也不隐藏**:有人就是想先想清楚再开口,那是他的自由。
               只是把它调成灰色并写明原因 —— 点不动又不说为什么,
               是这个项目已经踩过的坑(评估页那次)。
          */}
          <button
            onClick={() => setTab(tab === 'material' ? null : 'material')}
            className={cn(
              'hover:underline',
              waitingAgreement ? 'text-ink-400' : 'text-brand-600',
            )}
          >
            {waitingAgreement
              ? '要给他的信息(等他答应了再填)'
              : `要给他的信息 ${item.progress.done}/${item.progress.total}`}
          </button>
          <button
            onClick={() => setTab(tab === 'contact' ? null : 'contact')}
            className="text-brand-600 hover:underline"
          >
            联系方式
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


      {invite && (
        <div className="border-t border-ink-100 px-4 py-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-ink-900">邀请邮件(复制后发给他)</p>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(invite).then(() => setInviteCopied(true))
              }}
              className="text-sm text-brand-600 hover:underline"
            >
              {inviteCopied ? '已复制' : '复制全文'}
            </button>
          </div>
          <textarea
            readOnly
            value={invite}
            rows={16}
            className="w-full resize-y rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-xs leading-relaxed"
          />
          {/*
            ⚠️ 方括号那两处必须自己改 —— 「哪门课、什么关系」只有学生知道,
               而且正是这一句让老师想起你是谁。发出去之前不改,这封信就废了。
          */}
          <p className="mt-2 text-xs leading-relaxed text-ink-500">
            <strong className="text-ink-700">发之前先把方括号里的内容换掉</strong> ——
            尤其是「你们的交集」那一句,老师一学期带几百人,那句话决定他能不能想起你是谁。
          </p>
          <div className="mt-3">
            <Button size="sm" onClick={() => setStatus('invited')}>
              我已经发出去了
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

export function RefereeList({ items }: { items: RefereeItem[] }) {
  const router = useRouter()
  const [type, setType] = useState<RefereeType>('academic')
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  /**
   * ⚠️ 一次把联系方式收齐,不要只收一个名字。
   *
   *    原来这里只有「姓名 + 类型」,职称/单位/院系/邮箱/手机得事后再
   *    展开卡片上的「联系方式」补 —— 而这几项恰恰是你**加人的那一刻**
   *    手上就有的(你正准备给他发邮件)。隔一天再回来补,
   *    反而想不起院系全称怎么写、邮箱是学校后缀还是私人的。
   *
   *    除姓名外都可留空 —— 只记得姓和职称的时候不该被拦着。
   */
  const [form, setForm] = useState({
    name: '',
    title: '',
    institution: '',
    department: '',
    email: '',
    phone: '',
  })
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const FIELDS: Array<{ k: keyof typeof form; label: string; ph: string }> = [
    { k: 'title', label: '职称', ph: '如:副教授' },
    { k: 'institution', label: '单位', ph: '如:四川师范大学' },
    { k: 'department', label: '院系', ph: '如:法学院' },
    { k: 'email', label: '邮箱', ph: '优先用学校后缀邮箱' },
    { k: 'phone', label: '手机', ph: '选填' },
  ]

  return (
    <div className="space-y-3">
      {items.map((it) => (
        <RefereeCard key={it.id} item={it} />
      ))}

      {/* id 是给「婉拒了 → 换一位推荐人」那个按钮跳过来用的 */}
      <Card id="add-referee">
        <p className="mb-3 text-sm font-medium text-ink-900">添加推荐人</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs text-ink-500">姓名</span>
            <input
              value={form.name}
              onChange={set('name')}
              placeholder="推荐人姓名"
              className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </label>

          <label className="block">
            <span className="text-xs text-ink-500">关系</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as RefereeType)}
              className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
            >
              <option value="academic">学术推荐人(教过你课的老师)</option>
              <option value="professional">职业推荐人(实习或工作的上级)</option>
            </select>
          </label>

          {FIELDS.map((f) => (
            <label key={f.k} className="block">
              <span className="text-xs text-ink-500">{f.label}</span>
              <input
                value={form[f.k]}
                onChange={set(f.k)}
                placeholder={f.ph}
                className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </label>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Button
            onClick={() =>
              startTransition(async () => {
                const r = await createReferee({ ...form, type })
                if (r.ok) {
                  setForm({ name: '', title: '', institution: '', department: '', email: '', phone: '' })
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
          <span className="text-xs text-ink-400">除姓名外都可以留空,之后在卡片里补</span>
        </div>

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <p className="mt-3 text-xs leading-relaxed text-ink-400">
          这些是推荐人的个人信息,只用于你自己填写网申表格,不会发给任何第三方,注销账号时一并删除。
        </p>
      </Card>
    </div>
  )
}
