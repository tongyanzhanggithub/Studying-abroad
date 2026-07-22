import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { formatDate } from '@/lib/utils'
import { UNDERGRAD_TIER_LABEL, DIRECTION_LABEL } from '@/lib/programs/types'
import { ExportButton } from './ExportButton'

/**
 * 线索表(PRD 4.1 留资逻辑 / 4.10)。
 * 未付费用户 48 小时后跟进 —— MVP 阶段人工跟。
 */
export default async function AdminLeadsPage() {
  await requireAdmin('operator')

  const leads = await db.lead.findMany({
    orderBy: { createdAt: 'desc' },
    take: 300,
  })

  const now = Date.now()
  const needFollowUp = leads.filter(
    (l) => !l.convertedUserId && !l.followedUpAt && now - l.createdAt.getTime() > 48 * 3600_000,
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">线索</h1>
          <p className="mt-1 text-sm text-ink-600">
            共 {leads.length} 条,其中 {needFollowUp.length} 条超 48 小时未跟进
          </p>
        </div>
        <ExportButton />
      </div>

      <Card className="bg-ink-50">
        <p className="text-xs leading-relaxed text-ink-600">
          这些手机号是用户为查看评估结果而提供的,收集时已明示用途为
          「生成选校评估结果与后续申请提醒」。跟进时请勿超出该范围使用,
          也不得向第三方提供。
        </p>
      </Card>

      <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-ink-200 text-left text-xs text-ink-400">
            <tr>
              <th className="px-4 py-2">手机号</th>
              <th className="px-4 py-2">本科</th>
              <th className="px-4 py-2">GPA</th>
              <th className="px-4 py-2">方向</th>
              <th className="px-4 py-2">来源</th>
              <th className="px-4 py-2">时间</th>
              <th className="px-4 py-2">状态</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => {
              const p = l.assessPayload as Record<string, unknown>
              const stale =
                !l.convertedUserId &&
                !l.followedUpAt &&
                now - l.createdAt.getTime() > 48 * 3600_000
              return (
                <tr key={l.id} className="border-b border-ink-100 last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">{l.phone}</td>
                  <td className="px-4 py-2 text-xs">
                    {UNDERGRAD_TIER_LABEL[String(p.undergradTier)] ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {p.gpa ? `${p.gpa}${p.gpaScale === '4.0' ? '/4' : ''}` : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {DIRECTION_LABEL[String(p.targetDirection)] ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-400">{l.sourceChannel ?? '直接访问'}</td>
                  <td className="px-4 py-2 text-xs text-ink-400">{formatDate(l.createdAt)}</td>
                  <td className="px-4 py-2 text-xs">
                    {l.convertedUserId ? (
                      <span className="text-safe">已转化</span>
                    ) : stale ? (
                      <span className="text-urgent-warning">待跟进</span>
                    ) : (
                      <span className="text-ink-400">新线索</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
