'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Field } from '@/components/ui'
import { createEssay } from './actions'

export function NewEssayForm({
  options,
}: {
  options: Array<{ programId: string; label: string }>
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [programId, setProgramId] = useState('')
  const [promptText, setPromptText] = useState('')
  const [wordLimit, setWordLimit] = useState('')
  const [pending, startTransition] = useTransition()

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} variant="secondary">
        + 新建文书
      </Button>
    )
  }

  return (
    <Card>
      <h2 className="mb-4 font-medium text-ink-900">新建文书</h2>
      <div className="space-y-4">
        <Field label="文书标题">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="如:LSE 金融 PS"
            className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </Field>

        <Field label="对应院校" hint="选了院校才能做该校的 AI 政策合规检查">
          <select
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
            className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm"
          >
            <option value="">不指定</option>
            {options.map((o) => (
              <option key={o.programId} value={o.programId}>
                {o.label}
              </option>
            ))}
          </select>
          {options.length === 0 && (
            <span className="mt-1 block text-xs text-ink-400">
              选校单为空。先去「选校」加学校,这里才能关联。
            </span>
          )}
        </Field>

        <Field label="文书题目" hint="把学校官网上的原题贴进来,AI 会据此给建议">
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            rows={3}
            placeholder="Why do you want to study this programme at..."
            className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </Field>

        <Field label="字数上限" hint="留空表示不限">
          <input
            type="number"
            value={wordLimit}
            onChange={(e) => setWordLimit(e.target.value)}
            placeholder="如 500"
            className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </Field>

        <div className="flex gap-2">
          <Button
            disabled={pending || !title.trim()}
            onClick={() =>
              startTransition(async () => {
                const res = await createEssay({
                  title,
                  programId: programId || null,
                  promptText,
                  wordLimit: wordLimit ? Number(wordLimit) : null,
                })
                if (res.ok) router.push(`/app/essay/${res.essayId}`)
              })
            }
          >
            {pending ? '创建中…' : '创建并开始'}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            取消
          </Button>
        </div>
      </div>
    </Card>
  )
}
