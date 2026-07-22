import Link from 'next/link'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { formatDate } from '@/lib/utils'
import { REGION_LABEL, DIRECTION_LABEL, VERIFY_STALE_DAYS } from '@/lib/programs/types'
import { ProgramList } from './ProgramList'
import { ImportExport } from './ImportExport'

/**
 * 院校库 / 待核对工作队列(PRD 4.10)。
 *
 * 这一页是「数据是生命线」这条原则的执行界面:
 * AI 采集进来的数据默认全部躺在这里,核对通过后才会以确定值展示给用户。
 */
const PAGE_SIZE = 50

export default async function AdminProgramsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string; region?: string; page?: string }>
}) {
  await requireAdmin('data_entry')
  const { filter = 'pending', q, region, page } = await searchParams
  const pageNum = Math.max(1, Number(page) || 1)

  const staleBefore = new Date(Date.now() - VERIFY_STALE_DAYS * 86_400_000)

  const where =
    filter === 'pending'
      ? { confidence: { in: ['ai_collected' as const, 'unknown' as const] } }
      : filter === 'stale'
        ? { confidence: 'verified' as const, lastVerifiedAt: { lt: staleBefore } }
        : filter === 'verified'
          ? { confidence: 'verified' as const, lastVerifiedAt: { gte: staleBefore } }
          : {}

  const listWhere = {
    ...where,
    // 支持按地区筛选 —— 地区开放页的「去核对」链接会带上它,
    // 这样运营能一次只盯一个地区,而不是在 310 条里大海捞针
    ...(region ? { region: region as never } : {}),
    ...(q
      ? {
          OR: [
            { nameEn: { contains: q, mode: 'insensitive' as const } },
            { school: { nameEn: { contains: q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  }

  const [programs, matchCount, counts] = await Promise.all([
    db.program.findMany({
      where: listWhere,
      include: { school: true },
      orderBy: [{ region: 'asc' }, { schoolId: 'asc' }, { id: 'asc' }],
      skip: (pageNum - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.program.count({ where: listWhere }),
    Promise.all([
      db.program.count({ where: { confidence: { in: ['ai_collected', 'unknown'] } } }),
      db.program.count({
        where: { confidence: 'verified', lastVerifiedAt: { lt: staleBefore } },
      }),
      db.program.count({
        where: { confidence: 'verified', lastVerifiedAt: { gte: staleBefore } },
      }),
      db.program.count(),
    ]),
  ])

  const [pendingCount, staleCount, verifiedCount, totalCount] = counts
  const stalePercent = totalCount ? Math.round(((pendingCount + staleCount) / totalCount) * 100) : 0

  const totalPages = Math.max(1, Math.ceil(matchCount / PAGE_SIZE))
  const pageHref = (n: number) =>
    `/admin/programs?filter=${filter}${region ? `&region=${region}` : ''}${
      q ? `&q=${encodeURIComponent(q)}` : ''
    }&page=${n}`

  const TABS = [
    { key: 'pending', label: `待核对 ${pendingCount}` },
    { key: 'stale', label: `已过期 ${staleCount}` },
    { key: 'verified', label: `已核对 ${verifiedCount}` },
    { key: 'all', label: `全部 ${totalCount}` },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-ink-900">院校库</h1>
      </div>

      {/* Excel 导入 / 导出 */}
      <ImportExport filter={filter} />

      {/* PRD 11.3 健康度红线 */}
      {stalePercent > 10 && (
        <Card className="border-red-200 bg-red-50">
          <p className="text-sm leading-relaxed text-red-900">
            <strong>数据健康度告警:</strong>
            {stalePercent}% 的条目未核对或已过期(红线是 10%)。
            按 PRD 11.3,此时应<strong>暂停投放</strong>,优先补数据。
          </p>
        </Card>
      )}

      {region && (
        <Card className="bg-ink-50">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-600">
              已筛选地区:<strong className="text-ink-900">{REGION_LABEL[region] ?? region}</strong>
              (下方计数仍为全库总量)
            </p>
            <Link
              href={`/admin/programs?filter=${filter}`}
              className="text-sm text-brand-600 hover:underline"
            >
              查看全部地区
            </Link>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            // 切 tab 时保留地区筛选,否则一点就跳回全库
            href={`/admin/programs?filter=${t.key}${region ? `&region=${region}` : ''}`}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              filter === t.key
                ? 'border-brand-500 bg-brand-50 text-brand-700'
                : 'border-ink-200 bg-white text-ink-600'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <form action="/admin/programs" className="flex gap-2">
        <input type="hidden" name="filter" value={filter} />
        {region && <input type="hidden" name="region" value={region} />}
        <input
          name="q"
          defaultValue={q}
          placeholder="搜索院校或专业"
          className="flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm"
        />
        <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white">搜索</button>
      </form>

      {programs.length === 0 ? (
        <Card><p className="text-sm text-ink-600">没有符合条件的记录。</p></Card>
      ) : (
        <>
          <ProgramList
            rows={programs.map((p) => ({
              id: p.id,
              schoolName: p.school.nameZh ?? p.school.nameEn,
              programName: p.nameEn,
              region: REGION_LABEL[p.region] ?? p.region,
              direction: DIRECTION_LABEL[p.direction] ?? p.direction,
              verifiedLabel: p.lastVerifiedAt ? `核对于 ${formatDate(p.lastVerifiedAt)}` : '未核对',
              confidence: p.confidence,
            }))}
          />

          {/* 分页 —— 早先固定 take: 200,全库超过 200 条之后
              多出来的记录在后台完全看不到,也就永远核对不了 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-ink-500">
                第 {pageNum} / {totalPages} 页 · 共 {matchCount} 条
              </span>
              <div className="flex gap-2">
                {pageNum > 1 && (
                  <Link href={pageHref(pageNum - 1)} className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-ink-700">
                    上一页
                  </Link>
                )}
                {pageNum < totalPages && (
                  <Link href={pageHref(pageNum + 1)} className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-ink-700">
                    下一页
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
