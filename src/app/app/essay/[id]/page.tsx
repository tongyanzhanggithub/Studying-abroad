import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { requireUser, getActiveSubscription } from '@/lib/auth/session'
import { getRemainingQuota } from '@/lib/llm'
import { selectCard } from '@/lib/recommendation/engine'
import { EssayWorkbench } from './Workbench'

export default async function EssayPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  const { id } = await params

  const essay = await db.essay.findFirst({
    where: { id, userId: user.id },
    include: {
      program: { include: { school: true } },
      versions: { orderBy: { createdAt: 'desc' }, take: 1 },
      aiSessions: { where: { type: 'interview' }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })
  if (!essay) notFound()

  const subscription = await getActiveSubscription(user.id)
  const remainingQuota = subscription
    ? await getRemainingQuota(user.id, subscription.plan.aiDailyQuota)
    : 0

  const recCard = await selectCard(user.id, 'essay_sidebar')

  const interviewMessages =
    (essay.aiSessions[0]?.messages as Array<{ role: string; content: string }>) ?? []

  return (
    <div className="space-y-4">
      <Link href="/app/essays" className="text-sm text-brand-600 hover:underline">
        ← 返回文书列表
      </Link>

      <EssayWorkbench
        essayId={essay.id}
        title={essay.title}
        schoolName={
          essay.program
            ? `${essay.program.school.nameZh ?? essay.program.school.nameEn} · ${essay.program.nameZh ?? essay.program.nameEn}`
            : null
        }
        aiPolicyLevel={essay.program?.school.aiPolicyLevel ?? null}
        promptText={essay.promptText}
        wordLimit={essay.wordLimit}
        status={essay.status}
        polishRound={essay.polishRound}
        initialContent={essay.versions[0]?.content ?? ''}
        outline={(essay.outline as { text?: string } | null)?.text ?? null}
        interviewMessages={interviewMessages}
        complianceCheck={essay.complianceCheck as never}
        remainingQuota={remainingQuota}
        recCard={recCard}
      />
    </div>
  )
}
