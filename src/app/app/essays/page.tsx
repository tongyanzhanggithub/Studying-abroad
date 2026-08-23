import Link from 'next/link'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { NewEssayForm } from './NewEssayForm'
import { isAiAvailable } from '@/lib/llm/availability'
import { essayIntro } from '@/lib/llm/copy'

const STATUS_LABEL = {
  drafting: '写作中',
  polishing: '润色中',
  final: '已终稿',
} as const

export default async function EssaysPage() {
  const user = await requireUser()

  const [essays, choices] = await Promise.all([
    db.essay.findMany({
      where: { userId: user.id },
      include: { program: { include: { school: true } } },
      orderBy: { updatedAt: 'desc' },
    }),
    db.userSchoolChoice.findMany({
      where: { userId: user.id },
      include: { program: { include: { school: true } } },
      orderBy: { sort: 'asc' },
    }),
  ])

  const aiReady = await isAiAvailable()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">文书</h1>
        <p className="mt-1 text-sm leading-relaxed text-ink-600">{essayIntro(aiReady)}</p>
      </div>

      <NewEssayForm
        options={choices.map((c) => ({
          programId: c.programId,
          label: `${c.program.school.nameZh ?? c.program.school.nameEn} · ${c.program.nameZh ?? c.program.nameEn}`,
        }))}
      />

      {essays.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-600">
            还没有文书。上面新建一篇开始写。
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {essays.map((e) => (
            <Card key={e.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/app/essay/${e.id}`}
                    className="font-medium text-ink-900 hover:underline"
                  >
                    {e.title}
                  </Link>
                  {e.program && (
                    <p className="truncate text-sm text-ink-600">
                      {e.program.school.nameZh ?? e.program.school.nameEn} ·{' '}
                      {e.program.nameZh ?? e.program.nameEn}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-ink-400">
                  {e.polishRound > 0 && <span>第 {e.polishRound} 轮润色</span>}
                  <span
                    className={
                      e.status === 'final' ? 'text-safe' : 'text-ink-600'
                    }
                  >
                    {STATUS_LABEL[e.status]}
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
