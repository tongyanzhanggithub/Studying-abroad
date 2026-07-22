import Link from 'next/link'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { formatDate } from '@/lib/utils'
import { REGION_LABEL } from '@/lib/programs/types'
import { getLlmConfig } from '@/lib/settings'
import { CollectForm } from './CollectForm'

type Draft = { schoolNameEn: string }

function groupBySchool<T extends Draft>(drafts: T[]): Array<[string, T[]]> {
  const map = new Map<string, T[]>()
  for (const d of drafts) {
    const list = map.get(d.schoolNameEn)
    if (list) list.push(d)
    else map.set(d.schoolNameEn, [d])
  }
  // 条数多的排前面 —— 刚采完一整所学校的话,那一批就在最上面
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
}

/**
 * AI 采集入口 + 待审队列。
 *
 * 这一页存在的前提是「AI 抽出来的东西不算数」——
 * 队列里的每一条都必须有人点过才会进院校库。
 */
export default async function AdminCollectPage() {
  await requireAdmin('operator')

  const [cfg, pending, recent, counts] = await Promise.all([
    getLlmConfig(),
    db.programDraft.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    db.programDraft.findMany({
      where: { status: { not: 'pending' } },
      orderBy: { reviewedAt: 'desc' },
      take: 10,
    }),
    Promise.all([
      db.programDraft.count({ where: { status: 'approved' } }),
      db.programDraft.count({ where: { status: 'rejected' } }),
    ]),
  ])

  const [approvedCount, rejectedCount] = counts

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">AI 采集</h1>
        <p className="mt-1 text-sm leading-relaxed text-ink-600">
          让 AI 从院校官网页面里抽取项目信息。抽出来的结果
          <strong>一律先进待审队列</strong>,人工逐字段审核后才写进院校库 ——
          没有任何跳过审核的入口。
        </p>
      </div>

      <Card className="border-brand-200 bg-brand-50/50">
        <h2 className="text-sm font-medium text-ink-900">为什么必须人工审核</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-700">
          模型从网页抽字段一定会错:把「建议均分」读成「要求均分」、
          把上一届的截止日当成本届的、把学费的某一档当成全部。
          这些错误看上去都很合理,而学生会照着它规划申请。
          所以抽取时强制要求模型对每个字段给出<strong>原文出处</strong>,
          给不出出处的字段会被直接丢弃并在审核页标红。
        </p>
      </Card>

      <CollectForm hasKey={cfg.provider !== 'mock'} />

      <div>
        <h2 className="mb-3 text-lg font-medium text-ink-900">
          待审核 {pending.length > 0 && <span className="text-brand-600">({pending.length})</span>}
        </h2>

        {pending.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-600">队列是空的。</p>
          </Card>
        ) : (
          // 按学校分组 —— 一次采一所学校会进来二三十条,平铺成一长串没法用。
          // 同一所学校的项目页长得像,连着审也比来回跳学校快。
          <div className="space-y-4">
            {groupBySchool(pending).map(([school, items]) => (
              <div key={school}>
                <h3 className="mb-1.5 text-sm font-medium text-ink-700">
                  {school}
                  <span className="ml-2 font-normal text-ink-400">{items.length} 条待审</span>
                </h3>
                <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
                  {items.map((d, i) => (
                    <div
                      key={d.id}
                      className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 ${
                        i > 0 ? 'border-t border-ink-100' : ''
                      }`}
                    >
                      <Link
                        href={`/admin/collect/${d.id}`}
                        className="min-w-0 flex-1 truncate text-sm text-ink-900 hover:underline"
                      >
                        {d.programNameEn}
                      </Link>
                      <span className="shrink-0 text-xs text-ink-400">
                        {REGION_LABEL[d.region] ?? d.region}
                      </span>
                      {d.matchedProgramId && (
                        <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">
                          更新已有项目
                        </span>
                      )}
                      <span className="shrink-0 text-xs text-ink-400">
                        {formatDate(d.createdAt)}
                      </span>
                      <Link
                        href={`/admin/collect/${d.id}`}
                        className="shrink-0 text-xs text-brand-600 hover:underline"
                      >
                        审核 →
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {recent.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-medium text-ink-900">
            最近处理过的
            <span className="ml-2 text-sm font-normal text-ink-500">
              累计采纳 {approvedCount} · 丢弃 {rejectedCount}
            </span>
          </h2>
          <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
            {recent.map((d, i) => (
              <div
                key={d.id}
                className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm ${
                  i > 0 ? 'border-t border-ink-100' : ''
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-ink-700">
                  {d.schoolNameEn} · {d.programNameEn}
                </span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                    d.status === 'approved'
                      ? 'bg-green-50 text-green-800'
                      : 'bg-ink-100 text-ink-600'
                  }`}
                >
                  {d.status === 'approved' ? '已采纳' : '已丢弃'}
                </span>
                {d.rejectReason && (
                  <span className="shrink-0 text-xs text-ink-400">{d.rejectReason}</span>
                )}
                <span className="shrink-0 text-xs text-ink-400">
                  {d.reviewedAt && formatDate(d.reviewedAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
