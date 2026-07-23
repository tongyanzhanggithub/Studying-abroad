import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { formatDate } from '@/lib/utils'
import { readDeadlines, readRequirements, REGION_LABEL } from '@/lib/programs/types'
import { getPublicRegions } from '@/lib/regions/gate'
import { formatQsRank } from '@/lib/programs/ranking'
import { EditForm } from './EditForm'
import type { ProgramEditInput } from './actions'

/**
 * 单条院校数据核对页(PRD 4.10 待核对工作队列)。
 *
 * 右侧是官网来源链接,左侧是可编辑的字段 —— 运营对照官网逐条核对,
 * 发现错的当场改。核对不是「看一眼打个勾」:AI 采集的数据本来就会错,
 * 只能读不能改的核对页等于把错误固化下来。
 */
export default async function AdminProgramDetail({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdmin('data_entry')
  const { id } = await params

  const [program, publicRegions] = await Promise.all([
    db.program.findUnique({
      where: { id },
      include: { school: true, changeLogs: { orderBy: { createdAt: 'desc' }, take: 10 } },
    }),
    getPublicRegions(),
  ])
  if (!program) notFound()

  const req = readRequirements(program)
  const dl = readDeadlines(program)
  const qsRankLabel = formatQsRank(program.school.qsRank, program.school.qsRankYear)

  const initial: ProgramEditInput = {
    nameZh: program.nameZh ?? '',
    qsRank: program.school.qsRank?.toString() ?? '',
    qsRankYear: program.school.qsRankYear?.toString() ?? '',
    qsRankSourceUrl: program.school.qsRankSourceUrl ?? '',
    faculty: program.faculty ?? '',
    durationMonths: program.durationMonths?.toString() ?? '',
    tuition: program.tuition ?? '',
    campus: program.campus ?? '',
    isOnlineOnly: program.isOnlineOnly,
    competitiveness: program.competitiveness ?? '',
    barChangeFlag: program.barChangeFlag,
    sourceUrls: program.sourceUrls.join('\n'),
    notes: program.notes ?? '',

    undergradBackground: req.undergrad_background ?? '',
    chinaUniversityList: req.china_university_list ?? '',
    gpaRequirement: req.gpa_requirement ?? '',
    ieltsOverall: req.ielts?.overall?.toString() ?? '',
    ieltsSubscores: req.ielts?.subscores ?? '',
    toeflOverall: req.toefl?.overall?.toString() ?? '',
    toeflSubscores: req.toefl?.subscores ?? '',
    cet6Accepted: req.cet6_accepted ?? '',
    gmatGre: req.gmat_gre ?? '',
    prerequisites: req.prerequisites ?? '',
    workExperience: req.work_experience ?? '',
    interview: req.interview ?? '',

    opensAt: dl.opens_at ?? '',
    rolling: dl.rolling ?? program.isRolling,
    finalDeadline: dl.final_deadline ?? '',
    deadlineNotes: dl.notes ?? '',
  }

  return (
    <div className="space-y-5">
      <Link href="/admin/programs" className="text-sm text-brand-600 hover:underline">
        ← 返回列表
      </Link>

      <div>
        <h1 className="text-xl font-semibold text-ink-900">
          {program.school.nameZh ?? program.school.nameEn}
        </h1>
        <p className="text-ink-600">{program.nameEn}</p>
        <p className="mt-1 text-xs text-ink-400">
          {REGION_LABEL[program.region] ?? program.region} ·{' '}
          {qsRankLabel ? `${qsRankLabel} · ` : ''}
          {program.confidence === 'verified' ? '已核对' : '待核对'}
          {program.lastVerifiedAt && ` · 最后核对 ${formatDate(program.lastVerifiedAt)}`}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <EditForm
          programId={program.id}
          initial={initial}
          isPublicRegion={publicRegions.includes(program.region)}
          wasVerified={program.confidence === 'verified'}
        />

        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card>
            <h2 className="mb-2 font-medium text-ink-900">院校信息</h2>
            <p className="text-sm text-ink-700">
              QS 世界排名:{' '}
              {qsRankLabel ? (
                program.school.qsRankSourceUrl ? (
                  <a
                    href={program.school.qsRankSourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-600 hover:underline"
                  >
                    {qsRankLabel}
                  </a>
                ) : (
                  qsRankLabel
                )
              ) : (
                <span className="text-ink-400">待补</span>
              )}
            </p>
          </Card>

          <Card>
            <h2 className="mb-2 font-medium text-ink-900">官网来源</h2>
            {program.sourceUrls.length === 0 ? (
              <p className="text-sm text-ink-500">
                没有来源链接 —— 这一条没法核对,请先在左侧补上官网地址。
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {program.sourceUrls.map((u) => (
                  <li key={u}>
                    <a
                      href={u}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-brand-600 hover:underline"
                    >
                      {u}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {(dl.rounds?.length ?? 0) > 0 && (
            <Card>
              <h2 className="mb-2 font-medium text-ink-900">申请轮次</h2>
              <ul className="space-y-1.5 text-sm text-ink-700">
                {dl.rounds!.map((r, i) => (
                  <li key={i}>
                    {r.name}:{r.deadline ?? '未公布'}
                    {r.decision_by && ` · 放榜 ${r.decision_by}`}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-400">
                多轮结构暂不支持在表单里改,需要调整请改 `data/raw/` 后重新导入。
              </p>
            </Card>
          )}

          {program.changeLogs.length > 0 && (
            <Card>
              <h2 className="mb-2 font-medium text-ink-900">变更记录</h2>
              <div className="space-y-2">
                {program.changeLogs.map((log) => (
                  <div key={log.id} className="border-b border-ink-100 pb-2 text-sm last:border-0">
                    <p className="text-ink-800">{log.summary}</p>
                    <p className="text-xs text-ink-400">
                      {formatDate(log.createdAt)} · {log.notifiedAt ? '已推送用户' : '未推送'}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
