import Link from 'next/link'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { regenerateMaterials, getMaterialProgress } from '@/lib/materials/generate'
import { MaterialRow } from './MaterialRow'

/**
 * 材料中心(PRD 4.4)。
 * 清单由选校单自动合并生成,多校共用材料只出现一次并标注适用院校。
 */

export default async function MaterialsPage() {
  const user = await requireUser()

  // 进页面时重新合并一次,保证选校单变动后清单是最新的
  await regenerateMaterials(user.id)

  const [materials, progress, choices] = await Promise.all([
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
  ])

  const programNames = new Map(
    choices.map((c) => [
      c.programId,
      c.program.school.nameZh ?? c.program.school.shortName ?? c.program.school.nameEn,
    ]),
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">材料中心</h1>
        <p className="mt-1 text-sm text-ink-600">
          清单根据你的选校单自动生成。成绩单这类多校共用的材料只列一次。
        </p>
      </div>

      {materials.length === 0 ? (
        <Card>
          {/* 这两句要分开。早先无论哪种情况都说「选校单还是空的」——
              选校单里明明有学校时,这句话是错的,还会把人支去做一件已经做过的事 */}
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
          </Card>

          <div className="space-y-2">
            {materials.map((m) => (
              <MaterialRow
                key={m.id}
                id={m.id}
                name={m.template.name}
                description={m.template.description}
                guideMd={m.template.guideMd}
                status={m.status}
                fileName={m.fileName}
                fileRequired={m.template.fileRequired}
                appliesTo={m.programIds
                  .map((pid) => programNames.get(pid))
                  .filter((x): x is string => !!x)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
