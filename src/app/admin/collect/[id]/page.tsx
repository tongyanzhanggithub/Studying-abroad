import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { formatDate } from '@/lib/utils'
import { REGION_LABEL } from '@/lib/programs/types'
import type { ExtractedProgram } from '@/lib/collect/extract'
import { draftToFormValues } from '../actions'
import { ReviewForm } from './ReviewForm'

export default async function DraftReviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdmin('operator')
  const { id } = await params

  const draft = await db.programDraft.findUnique({ where: { id } })
  if (!draft) notFound()

  const payload = draft.payload as unknown as ExtractedProgram
  const initial = await draftToFormValues(payload)

  return (
    <div className="space-y-5">
      <Link href="/admin/collect" className="text-sm text-brand-600 hover:underline">
        ← 返回队列
      </Link>

      <div>
        <h1 className="text-xl font-semibold text-ink-900">{draft.schoolNameEn}</h1>
        <p className="text-ink-600">{draft.programNameEn}</p>
        <p className="mt-1 text-xs text-ink-400">
          {REGION_LABEL[draft.region] ?? draft.region} · 采集于 {formatDate(draft.createdAt)} ·{' '}
          {draft.model ?? '未知模型'} · {draft.tokensUsed} tokens
        </p>
      </div>

      {draft.status !== 'pending' && (
        <Card className="border-ink-200 bg-ink-50">
          <p className="text-sm text-ink-700">
            这条已经{draft.status === 'approved' ? '采纳' : '丢弃'}过了
            {draft.reviewedAt && `(${formatDate(draft.reviewedAt)})`}
            {draft.rejectReason && ` —— ${draft.rejectReason}`}。
          </p>
          {draft.resultProgramId && (
            <Link
              href={`/admin/programs/${draft.resultProgramId}`}
              className="mt-2 inline-block text-sm text-brand-600 hover:underline"
            >
              查看院校库里的这条 →
            </Link>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {draft.status === 'pending' ? (
          <ReviewForm
            draftId={draft.id}
            initial={initial}
            payload={payload}
            sourceUrl={draft.sourceUrl}
            isUpdate={Boolean(draft.matchedProgramId)}
          />
        ) : (
          <Card>
            <pre className="max-h-[600px] overflow-auto rounded-lg bg-ink-50 p-3 text-xs whitespace-pre-wrap text-ink-800">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </Card>
        )}

        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card>
            <h2 className="mb-2 font-medium text-ink-900">来源</h2>
            <a
              href={draft.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block break-all text-sm text-brand-600 hover:underline"
            >
              {draft.sourceUrl}
            </a>
          </Card>

          {draft.sourceText && (
            <Card>
              <h2 className="mb-2 font-medium text-ink-900">抓到的正文</h2>
              <p className="mb-2 text-xs text-ink-400">
                模型看到的就是这些。字段对不上时先来这里搜一下 ——
                多半是官网把信息放在了另一个页面。
              </p>
              <pre className="max-h-96 overflow-auto rounded-lg bg-ink-50 p-3 text-xs leading-relaxed whitespace-pre-wrap text-ink-700">
                {draft.sourceText}
              </pre>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
