'use client'

import { useState, useRef, useTransition } from 'react'
import { Card } from '@/components/ui'
import { cn } from '@/lib/utils'
import { saveStoryAnswer } from './actions'
import type { StorySection } from '@/lib/essays/question-bank'

/** 停止输入多久之后自动保存 */
const AUTOSAVE_MS = 1200

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * 单个问题。
 *
 * ⚠️ 自动保存必须做,而且必须**把失败告诉用户**。
 *    素材是学生一段一段回忆着写出来的,重打一遍的代价很高。
 *    静默失败等于让他以为存住了 —— 这个坑文书工作台踩过一次,不再踩第二次。
 */
function Question({
  id,
  q,
  hint,
  core,
  long,
  initial,
}: {
  id: string
  q: string
  hint?: string
  core?: boolean
  long?: boolean
  initial: string
}) {
  const [value, setValue] = useState(initial)
  const [state, setState] = useState<SaveState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [, startTransition] = useTransition()

  function scheduleSave(next: string) {
    if (timer.current) clearTimeout(timer.current)
    setState('saving')
    timer.current = setTimeout(() => {
      startTransition(async () => {
        const r = await saveStoryAnswer(id, next).catch(() => null)
        setState(r?.ok ? 'saved' : 'error')
      })
    }, AUTOSAVE_MS)
  }

  const answered = value.trim().length > 0

  return (
    <div className="border-t border-ink-100 py-4 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
            answered ? 'bg-safe' : core ? 'bg-brand-400' : 'bg-ink-200',
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-900">
            {q}
            {!core && <span className="ml-2 text-xs font-normal text-ink-400">选答</span>}
          </p>
          {hint && <p className="mt-1 text-xs leading-relaxed text-ink-500">{hint}</p>}

          <textarea
            value={value}
            rows={long ? 4 : 2}
            onChange={(e) => {
              setValue(e.target.value)
              scheduleSave(e.target.value)
            }}
            placeholder="用中文写就行,想到哪儿写到哪儿 —— 这是给自己看的素材,不是成稿"
            className="mt-2 w-full resize-y rounded-lg border border-ink-200 px-3 py-2 text-sm leading-relaxed outline-none focus:border-brand-500"
          />

          <div className="mt-1 h-4 text-xs">
            {state === 'saving' && <span className="text-ink-400">保存中…</span>}
            {state === 'saved' && <span className="text-ink-400">已保存</span>}
            {state === 'error' && (
              <span className="font-medium text-red-600">
                没保存上 —— 先把这段文字复制一份再刷新页面
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function StoryForm({
  sections,
  answers,
}: {
  sections: StorySection[]
  answers: Record<string, string>
}) {
  const [openId, setOpenId] = useState<string | null>(sections[0]?.id ?? null)

  return (
    <div className="space-y-3">
      {sections.map((s) => {
        const open = openId === s.id
        const core = s.questions.filter((q) => q.core)
        const done = core.filter((q) => (answers[q.id] ?? '').trim()).length

        return (
          <Card key={s.id} className="p-0">
            <button
              onClick={() => setOpenId(open ? null : s.id)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <div className="min-w-0">
                <p className="font-medium text-ink-900">{s.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{s.why}</p>
              </div>
              <span className="shrink-0 text-xs text-ink-400">
                {done}/{core.length}
                <span className="ml-2">{open ? '收起' : '展开'}</span>
              </span>
            </button>

            {open && (
              <div className="border-t border-ink-100 px-4 pt-4 pb-4">
                {s.questions.map((q) => (
                  <Question key={q.id} {...q} initial={answers[q.id] ?? ''} />
                ))}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}
