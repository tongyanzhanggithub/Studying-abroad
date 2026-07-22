'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Field } from '@/components/ui'
import { cn } from '@/lib/utils'
import { TIER_TAG_LABEL, UNDERGRAD_TIER_LABEL } from '@/lib/programs/types'
import { completeOnboarding } from './actions'

interface Suggestion {
  programId: string
  schoolName: string
  programName: string
  tier: string
  probabilityLow: number
  probabilityHigh: number
}

export function OnboardingFlow({
  profileDraft,
  suggestions,
}: {
  profileDraft: {
    undergradTier: string | null
    gpa: number | null
    gpaScale: string
    languageType: string | null
    languageScore: number | null
  }
  suggestions: Suggestion[]
}) {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [profile, setProfile] = useState(profileDraft)
  const [selected, setSelected] = useState<Set<string>>(
    new Set(suggestions.map((s) => s.programId)),
  )
  const [pending, startTransition] = useTransition()

  return (
    <>
      <div className="flex items-center gap-2">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={cn('h-1 flex-1 rounded-full', s <= step ? 'bg-brand-500' : 'bg-ink-200')}
          />
        ))}
        <span className="ml-2 text-xs text-ink-400">{step}/3</span>
      </div>

      {step === 1 && (
        <Card>
          <h2 className="mb-1 font-medium text-ink-900">确认你的背景</h2>
          <p className="mb-4 text-sm text-ink-600">
            这是你做免费评估时填的,如果有变化在这里改。
          </p>
          <div className="space-y-3 text-sm">
            <Field label="本科院校层级">
              <p className="rounded-lg bg-ink-50 px-3 py-2 text-ink-800">
                {profile.undergradTier
                  ? UNDERGRAD_TIER_LABEL[profile.undergradTier]
                  : '未填写'}
              </p>
            </Field>
            <Field label="GPA">
              <input
                type="number"
                step="0.01"
                value={profile.gpa ?? ''}
                onChange={(e) =>
                  setProfile({ ...profile, gpa: e.target.value ? Number(e.target.value) : null })
                }
                className="w-full rounded-lg border border-ink-200 px-3 py-2 outline-none focus:border-brand-500"
              />
            </Field>
            <Field label="语言成绩">
              <input
                type="number"
                step="0.5"
                value={profile.languageScore ?? ''}
                placeholder={profile.languageType === 'none' ? '还没考' : ''}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    languageScore: e.target.value ? Number(e.target.value) : null,
                  })
                }
                className="w-full rounded-lg border border-ink-200 px-3 py-2 outline-none focus:border-brand-500"
              />
            </Field>
          </div>
          <Button className="mt-5 w-full" onClick={() => setStep(2)}>
            下一步
          </Button>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <h2 className="mb-1 font-medium text-ink-900">选校单初稿</h2>
          <p className="mb-4 text-sm leading-relaxed text-ink-600">
            这是根据评估结果生成的初稿,不是推荐 ——
            取消勾选不想要的,之后也可以随时在「选校」里增删。
          </p>
          <div className="space-y-2">
            {suggestions.map((s) => (
              <label
                key={s.programId}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border p-3',
                  selected.has(s.programId)
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-ink-200 bg-white',
                )}
              >
                <input
                  type="checkbox"
                  checked={selected.has(s.programId)}
                  onChange={(e) => {
                    const next = new Set(selected)
                    if (e.target.checked) next.add(s.programId)
                    else next.delete(s.programId)
                    setSelected(next)
                  }}
                  className="mt-1"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink-900">{s.schoolName}</span>
                    <span className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600">
                      {TIER_TAG_LABEL[s.tier]}
                    </span>
                  </div>
                  <p className="truncate text-sm text-ink-600">{s.programName}</p>
                  <p className="text-xs text-ink-400">
                    预估 {s.probabilityLow}–{s.probabilityHigh}%
                  </p>
                </div>
              </label>
            ))}
          </div>
          <div className="mt-5 flex gap-2">
            <Button variant="secondary" onClick={() => setStep(1)}>
              上一步
            </Button>
            <Button className="flex-1" disabled={selected.size === 0} onClick={() => setStep(3)}>
              选好了({selected.size} 所)
            </Button>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <h2 className="mb-1 font-medium text-ink-900">生成材料清单</h2>
          <p className="mb-4 text-sm leading-relaxed text-ink-600">
            系统会根据这 {selected.size} 所学校的要求自动合并出一份材料清单,
            多校共用的材料(比如成绩单)只会出现一次。
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep(2)} disabled={pending}>
              上一步
            </Button>
            <Button
              className="flex-1"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await completeOnboarding({
                    profile,
                    selected: suggestions
                      .filter((s) => selected.has(s.programId))
                      .map((s) => ({ programId: s.programId, tier: s.tier })),
                  })
                  router.push('/app/dashboard')
                })
              }
            >
              {pending ? '生成中…' : '完成设置'}
            </Button>
          </div>
        </Card>
      )}
    </>
  )
}
