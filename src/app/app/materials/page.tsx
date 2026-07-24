import Link from 'next/link'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { regenerateMaterials, getMaterialProgress } from '@/lib/materials/generate'
import { daysUntil } from '@/lib/utils'
import { MaterialRow, type MaterialWarning } from './MaterialRow'

/**
 * 材料中心(PRD 4.4)。
 *
 * 不只是「上传管理」。四件事叠在一起:
 *   1. 清单由选校单**自动合并**生成,多校共用材料只列一次(去重)。
 *   2. **到手倒计时预警**:每样材料有办理周期(leadTimeDays),对上最近的截止日,
 *      算出「按常规周期赶不赶得上」—— 推荐信要提前 4-6 周,雅思出分两个月,
 *      光在截止前提醒早就来不及了。
 *   3. 清单**按紧急度排序**:快来不及的排最上面,已完成的沉到底。
 *   4. **文书也并进来看**:文书是独立模块,但在这里一并显示进度,一处看全该交什么。
 */

const ESSAY_STATUS_LABEL: Record<string, string> = {
  drafting: '素材/写作中',
  polishing: '润色中',
  final: '已终稿',
}

export default async function MaterialsPage() {
  const user = await requireUser()

  // 进页面时重新合并一次,保证选校单变动后清单是最新的
  await regenerateMaterials(user.id)

  const [materials, progress, choices, essays] = await Promise.all([
    db.userMaterial.findMany({
      where: { userId: user.id },
      include: { template: true },
      orderBy: { template: { sort: 'asc' } },
    }),
    getMaterialProgress(user.id),
    db.userSchoolChoice.findMany({
      where: { userId: user.id },
      include: { program: { include: { school: true } } },
    }),
    db.essay.findMany({
      where: { userId: user.id },
      include: { program: { include: { school: true } } },
      orderBy: { updatedAt: 'desc' },
    }),
  ])

  const programNames = new Map(
    choices.map((c) => [
      c.programId,
      c.program.school.nameZh ?? c.program.school.shortName ?? c.program.school.nameEn,
    ]),
  )

  /**
   * 给一份材料算「到手倒计时」。
   * 只对**未完成**且**有截止日**的材料算 —— 已办好的不用催,没截止日的没法算。
   */
  function warningFor(m: (typeof materials)[number]): MaterialWarning {
    if (m.status === 'completed') return { level: 'done' }
    const deadlines = choices
      .filter((c) => m.programIds.includes(c.programId))
      .map((c) => daysUntil(c.program.finalDeadline))
      .filter((d): d is number => d !== null && d >= 0)
    if (deadlines.length === 0) return { level: 'none' }

    const days = Math.min(...deadlines)
    const lead = m.template.leadTimeDays
    const slack = days - lead // 剩余天数 - 办理周期,负数=常规来不及
    const level = slack < 0 ? 'overdue' : slack < 14 ? 'urgent' : 'ample'
    return { level, days, lead, slack }
  }

  // 按紧急度排序:未完成且越急的越靠前;有截止日的优先于没截止日的;已完成沉底
  const rank = (w: MaterialWarning) => {
    if (!('slack' in w)) return w.level === 'done' ? 1e9 : 1e6 // 已完成沉底;没截止日排其后
    return w.slack // 越小越急,越靠前
  }
  const rows = materials
    .map((m) => ({ m, w: warningFor(m) }))
    .sort((a, b) => rank(a.w) - rank(b.w))

  const overdueCount = rows.filter((r) => r.w.level === 'overdue').length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">材料中心</h1>
        <p className="mt-1 text-sm text-ink-600">
          清单根据选校单自动生成、按学校去重,并按「快来不及的排最前」排序。
        </p>
      </div>

      {materials.length === 0 ? (
        <Card>
          {choices.length === 0 ? (
            <>
              <p className="text-sm text-ink-600">
                选校单还是空的,所以还生成不了材料清单。选好学校后,这里会自动按学校去重生成清单。
              </p>
              <Link
                href="/app/schools"
                className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
              >
                去选校 →
              </Link>
            </>
          ) : (
            <p className="text-sm leading-relaxed text-ink-600">
              选校单里有 {choices.length} 所学校,但没能生成材料清单 —— 这是我们这边的问题,
              不是你哪一步没做。请刷新重试;还是空的话联系客服,别自己照着猜清单准备。
            </p>
          )}
        </Card>
      ) : (
        <>
          <Card>
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink-600">
                已完成 {progress.done} / {progress.total}
              </span>
              <span className="text-lg font-semibold text-ink-900">{progress.percent}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
              <div
                className="h-full rounded-full bg-brand-500 transition-all"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            {overdueCount > 0 && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-700">
                有 <strong>{overdueCount}</strong> 项按常规办理周期已经赶不上最近的截止日 ——
                下面标红的先办,现在动手还能走加急。
              </p>
            )}
          </Card>

          <div className="space-y-2">
            {rows.map(({ m, w }) => (
              <MaterialRow
                key={m.id}
                id={m.id}
                name={m.template.name}
                description={m.template.description}
                guideMd={m.template.guideMd}
                status={m.status}
                fileName={m.fileName}
                fileRequired={m.template.fileRequired}
                warning={w}
                appliesTo={m.programIds
                  .map((pid) => programNames.get(pid))
                  .filter((x): x is string => !!x)}
              />
            ))}
          </div>

          {/* ── 文书:独立模块,这里并进来一起看进度 ── */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold text-ink-900">文书</h2>
              <Link href="/app/essays" className="text-sm text-brand-600 hover:underline">
                去文书工作台 →
              </Link>
            </div>
            {essays.length === 0 ? (
              <Card>
                <p className="text-sm text-ink-600">
                  还没有文书。文书按学校要求分开写,
                  <Link href="/app/essays" className="text-brand-600 hover:underline">
                    去新建一篇
                  </Link>
                  。
                </p>
              </Card>
            ) : (
              <div className="space-y-2">
                {essays.map((e) => (
                  <Card key={e.id} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <Link
                          href={`/app/essay/${e.id}`}
                          className="font-medium text-ink-900 hover:underline"
                        >
                          {e.title}
                        </Link>
                        {e.program && (
                          <span className="ml-2 text-xs text-ink-400">
                            {e.program.school.nameZh ?? e.program.school.nameEn}
                          </span>
                        )}
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                          e.status === 'final'
                            ? 'bg-green-50 text-green-700'
                            : 'bg-ink-100 text-ink-600'
                        }`}
                      >
                        {ESSAY_STATUS_LABEL[e.status] ?? e.status}
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
