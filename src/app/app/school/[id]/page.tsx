import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { Card, FreshnessBadge } from '@/components/ui'
import { formatDate } from '@/lib/utils'
import {
  DIRECTION_LABEL,
  REGION_LABEL,
  FRESHNESS_LABEL,
  programFreshness,
  readDeadlines,
  readRequirements,
} from '@/lib/programs/types'
import { formatQsRank } from '@/lib/programs/ranking'

/**
 * 院校详情(PRD 3.1 `/app/school/:id`)。
 *
 * ⚠️ 数据可信度是这一页的第一要务:
 *    每个字段都要能追溯到官网来源,未核对的必须显著标注。
 */

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null
  return (
    <div className="flex flex-col gap-0.5 border-b border-ink-100 py-2.5 last:border-0 sm:flex-row sm:gap-4">
      <span className="shrink-0 text-sm text-ink-400 sm:w-32">{label}</span>
      <span className="flex-1 text-sm leading-relaxed text-ink-800">{value}</span>
    </div>
  )
}

export default async function SchoolDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireUser()
  const { id } = await params

  const program = await db.program.findUnique({
    where: { id },
    include: { school: true, materialTemplates: { include: { template: true } } },
  })
  if (!program) notFound()

  const req = readRequirements(program)
  const dl = readDeadlines(program)
  const freshness = programFreshness(program)
  const qsRankLabel = formatQsRank(program.school.qsRank, program.school.qsRankYear)

  return (
    <div className="space-y-6">
      <Link href="/app/schools" className="text-sm text-brand-600 hover:underline">
        ← 返回选校
      </Link>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          {/* 学校名可点回学校总览 —— 看完这个专业,常常想看看这所学校还开了什么 */}
          <Link
            href={`/app/university/${program.schoolId}`}
            className="text-2xl font-semibold text-ink-900 hover:underline"
          >
            {program.school.nameZh ?? program.school.nameEn}
          </Link>
          <span className="text-sm text-ink-400">{REGION_LABEL[program.region]}</span>
          {qsRankLabel && (
            <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
              {qsRankLabel}
            </span>
          )}
          <FreshnessBadge freshness={freshness} label={FRESHNESS_LABEL[freshness]} />
        </div>
        <p className="mt-1 text-lg text-ink-600">{program.nameZh ?? program.nameEn}</p>
        <p className="text-sm text-ink-400">{program.nameEn}</p>
      </div>

      {program.isOnlineOnly && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm leading-relaxed text-amber-900">
            <strong>这是一个纯线上 / 远程授课项目。</strong>
            这类项目通常<strong>不支持学生签证</strong>,也就意味着你无法凭它出境读书、
            获得当地身份或毕业后工作签。如果你的目标是真正出国,请确认清楚再申请;
            如果你本来就打算在国内远程读学位,那这类项目是合适的。
            具体请以院校官网说明为准。
          </p>
        </Card>
      )}

      {freshness !== 'fresh' && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm leading-relaxed text-amber-900">
            <strong>这份数据尚未经过人工核对。</strong>
            我们从院校官网采集了这些信息,但在运营团队逐条核实之前,
            请务必以下方来源链接中的官网页面为准。发现不一致时,以官网为准。
          </p>
        </Card>
      )}

      <Card>
        <h2 className="mb-2 font-medium text-ink-900">基本信息</h2>
        <Row
          label="QS 世界排名"
          value={
            qsRankLabel
              ? program.school.qsRankSourceUrl
                ? (
                    <a
                      href={program.school.qsRankSourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-600 hover:underline"
                    >
                      {qsRankLabel}
                    </a>
                  )
                : qsRankLabel
              : null
          }
        />
        <Row label="学院" value={program.faculty} />
        <Row label="方向" value={DIRECTION_LABEL[program.direction]} />
        <Row label="学制" value={program.durationMonths ? `${program.durationMonths} 个月` : null} />
        <Row label="学费" value={program.tuition} />
        <Row label="校区" value={program.campus} />
      </Card>

      <Card>
        <h2 className="mb-2 font-medium text-ink-900">录取要求</h2>
        <Row label="本科背景" value={req.undergrad_background} />
        <Row label="中国院校名单" value={req.china_university_list} />
        <Row label="GPA / 均分" value={req.gpa_requirement} />
        <Row
          label="雅思"
          value={
            req.ielts?.overall
              ? `总分 ${req.ielts.overall}${req.ielts.subscores ? ` · ${req.ielts.subscores}` : ''}`
              : null
          }
        />
        <Row
          label="托福"
          value={
            req.toefl?.overall
              ? `总分 ${req.toefl.overall}${req.toefl.subscores ? ` · ${req.toefl.subscores}` : ''}`
              : null
          }
        />
        <Row label="六级替代" value={req.cet6_accepted} />
        <Row label="GMAT / GRE" value={req.gmat_gre} />
        <Row label="先修课" value={req.prerequisites} />
        <Row label="工作经验" value={req.work_experience} />
        <Row label="面试" value={req.interview} />
      </Card>

      <Card>
        <h2 className="mb-2 font-medium text-ink-900">申请时间</h2>
        {dl.final_deadline || dl.rounds?.length ? (
          <>
            <Row label="开放申请" value={dl.opens_at ? formatDate(dl.opens_at) : null} />
            <Row label="滚动录取" value={dl.rolling ? '是 —— 建议尽早申请,招满即止' : null} />
            {dl.rounds?.map((r, i) => (
              <Row
                key={i}
                label={r.name || `第 ${i + 1} 轮`}
                value={r.deadline ? formatDate(r.deadline) : '待公布'}
              />
            ))}
            <Row label="最终截止" value={dl.final_deadline ? formatDate(dl.final_deadline) : null} />
          </>
        ) : (
          <p className="py-2 text-sm leading-relaxed text-ink-600">
            该项目 2027 入学的申请日期尚未公布。院校通常在 9-10 月放出,
            官网更新后系统会推送提醒。
          </p>
        )}
        {dl.notes && (
          <p className="mt-2 rounded-lg bg-ink-100 px-3 py-2 text-xs leading-relaxed text-ink-600">
            {dl.notes}
          </p>
        )}
      </Card>

      {program.materialTemplates.length > 0 && (
        <Card>
          <h2 className="mb-2 font-medium text-ink-900">申请材料</h2>
          <ul className="space-y-1 text-sm text-ink-600">
            {program.materialTemplates.map((m) => (
              <li key={m.templateId}>· {m.template.name}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <h2 className="mb-2 font-medium text-ink-900">数据来源</h2>
        <ul className="space-y-1 text-sm">
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
        <p className="mt-3 text-xs text-ink-400">
          最后核对:
          {program.lastVerifiedAt ? formatDate(program.lastVerifiedAt) : '尚未核对'}
        </p>
        {program.notes && (
          <p className="mt-2 rounded-lg bg-ink-100 px-3 py-2 text-xs leading-relaxed text-ink-600">
            {program.notes}
          </p>
        )}
      </Card>
    </div>
  )
}
