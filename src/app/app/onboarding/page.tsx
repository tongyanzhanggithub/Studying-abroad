import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { OnboardingFlow } from './Flow'
import type { AssessmentResult } from '@/lib/assessment/engine'

/**
 * 首次登录引导(PRD 5.1)。
 * 确认评估数据 → 生成选校单初稿 → 生成材料清单 → 进入 Dashboard
 */
export default async function OnboardingPage() {
  const user = await requireUser()

  const existing = await db.userSchoolChoice.count({ where: { userId: user.id } })
  if (existing > 0) redirect('/app/dashboard')

  // 取该手机号最近一次免费评估,作为选校单初稿的依据
  const lead = await db.lead.findFirst({
    where: { phone: user.phone },
    orderBy: { createdAt: 'desc' },
  })

  const result = lead?.assessResult as unknown as AssessmentResult | null
  const payload = lead?.assessPayload as Record<string, unknown> | null

  const suggestions = result
    ? [...result.reach, ...result.match, ...result.safe]
    : []

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">开始设置</h1>
        <p className="mt-1 text-sm text-ink-600">
          三步搞定,之后就可以开始准备材料了。
        </p>
      </div>

      {suggestions.length === 0 ? (
        <Card>
          <p className="text-sm leading-relaxed text-ink-600">
            没有找到你之前的免费评估记录,所以生成不了选校单初稿。
            你可以直接去院校库自己挑,或者先做一次评估。
          </p>
          <div className="mt-4 flex gap-3 text-sm">
            <a href="/app/schools" className="text-brand-600 hover:underline">
              去院校库 →
            </a>
            <a href="/assess" className="text-brand-600 hover:underline">
              做一次评估 →
            </a>
          </div>
        </Card>
      ) : (
        <OnboardingFlow
          profileDraft={{
            undergradTier: (payload?.undergradTier as string) ?? null,
            gpa: (payload?.gpa as number) ?? null,
            gpaScale: (payload?.gpaScale as string) ?? '100',
            languageType: (payload?.languageType as string) ?? null,
            languageScore: (payload?.languageScore as number) ?? null,
          }}
          suggestions={suggestions.map((s) => ({
            programId: s.programId,
            schoolName: s.schoolName,
            programName: s.programName,
            tier: s.tier,
            probabilityLow: s.probabilityLow,
            probabilityHigh: s.probabilityHigh,
          }))}
        />
      )}
    </div>
  )
}
