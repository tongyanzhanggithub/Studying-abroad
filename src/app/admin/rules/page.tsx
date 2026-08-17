import Link from 'next/link'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { UNDERGRAD_TIER_LABEL } from '@/lib/programs/types'

/**
 * 录取概率规则(只读)。
 *
 * ── 为什么需要这一页 ────────────────────────────────────
 * AdmissionRule 决定每个用户在评估结果里看到的「预估录取概率」,是这个产品
 * 对外说的最重的一句话。但它此前在后台**完全没有入口** —— 15120 条规则,
 * 运营看不到、改不了、也无从判断准不准,而种子数据里明写着
 * 「初始估值,需运营用真实录取案例校准」。
 *
 * ── 这一页要说清的第一件事 ──────────────────────────────
 * ⚠️ 15120 条规则实际只有 **40 个不同取值**。region 和 direction 进了唯一键,
 *    但对概率**没有任何影响** —— 14 个地区 × 27 个方向共用同一张
 *    (本科层级 × GPA 档 × 院校档)表。
 *
 *    也就是说:同样背景的学生,申「香港商科」和申「英国计算机」,
 *    看到的预估概率完全一样。而界面把它呈现成针对该地区该专业的估算。
 *    这不是 bug,是当前实现的真实精度 —— 但运营必须知道,
 *    否则会拿它当作有地区/专业区分度的数据去跟学生解释。
 *
 * 刻意做成只读:概率怎么校准是产品与业务决策(要用真实录取案例回归),
 * 不该在这里加一个「随手改个数字」的入口 —— 那只会让它更不可信。
 */
export default async function AdminRulesPage() {
  await requireAdmin('operator')

  const [rules, programCount, tierCounts] = await Promise.all([
    db.admissionRule.findMany(),
    db.program.count(),
    db.program.groupBy({ by: ['competitiveness'], _count: true }),
  ])

  /** 把 15120 条压回它真正的 40 个取值 */
  const shapes = new Map<
    string,
    { undergradTier: string; gpaMin: number; gpaMax: number; schoolTier: string; values: Set<string> }
  >()
  for (const r of rules) {
    const key = `${r.undergradTier}|${r.gpaMin}|${r.schoolTier}`
    const cur = shapes.get(key)
    const value = `${r.probabilityLow}-${r.probabilityHigh}`
    if (cur) cur.values.add(value)
    else
      shapes.set(key, {
        undergradTier: r.undergradTier,
        gpaMin: r.gpaMin,
        gpaMax: r.gpaMax,
        schoolTier: r.schoolTier,
        values: new Set([value]),
      })
  }

  /** 概率随地区/方向变化的组合数 —— 目前应当是 0,一旦不是 0 说明有人做了差异化 */
  const varying = [...shapes.values()].filter((s) => s.values.size > 1).length

  const regions = new Set(rules.map((r) => r.region)).size
  const directions = new Set(rules.map((r) => r.direction)).size
  const schoolTiers = [...new Set(rules.map((r) => r.schoolTier))].sort()
  const undergradTiers = [...new Set(rules.map((r) => r.undergradTier))]
  const bands = [...new Map(rules.map((r) => [r.gpaMin, { min: r.gpaMin, max: r.gpaMax }])).values()].sort(
    (a, b) => b.min - a.min,
  )

  const cell = (undergradTier: string, gpaMin: number, schoolTier: string) => {
    const s = shapes.get(`${undergradTier}|${gpaMin}|${schoolTier}`)
    if (!s) return null
    return [...s.values].join(' / ')
  }

  /** 各院校档在库里实际有多少项目 —— 规则再准,没有项目落在这一档也是白配 */
  const tieredPrograms = new Map<string, number>()
  for (const t of tierCounts) {
    const key = (t.competitiveness ?? '').trim().toLowerCase() || '(未标注,走兜底判断)'
    tieredPrograms.set(key, (tieredPrograms.get(key) ?? 0) + t._count)
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Admission Rules</p>
        <h1 className="text-2xl font-semibold text-ink-900">录取概率规则</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-500">
          评估结果里每一条「预估录取概率」都来自这张表。只读 —— 概率校准要用真实录取案例做,
          不适合在后台随手改数字。
        </p>
      </div>

      {/* ⚠️ 这一页最重要的一句话,放最上面 */}
      <Card className="border-amber-200 bg-amber-50/60">
        {/* ⚠️ 这里是 JSX,不是 markdown —— 写 ** 只会把星号原样渲染出来(DISCLAIMER 踩过) */}
        <h2 className="text-sm font-semibold text-amber-900">
          地区与专业方向目前不影响概率
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-amber-900">
          库里有 <strong>{rules.length.toLocaleString()}</strong> 条规则,但实际只有{' '}
          <strong>{shapes.size}</strong> 个不同取值 —— {regions} 个地区 × {directions} 个方向
          共用同一张「本科层级 × GPA 档 × 院校档」表。
          {varying === 0
            ? '目前没有任何一个组合做过地区或方向的差异化。'
            : `其中 ${varying} 个组合已按地区/方向做了差异化。`}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-amber-800">
          也就是说:同样背景的学生,申「香港商科」和申「英国计算机」看到的预估概率是一样的。
          跟学生解释时不要说成「这个专业在这个地区的录取率」——
          它现在只反映本科层级、GPA 和院校档次。
        </p>
      </Card>

      {/* 真正的 40 个取值 */}
      {undergradTiers.map((ut) => (
        <Card key={ut}>
          <h2 className="mb-3 font-medium text-ink-900">
            {UNDERGRAD_TIER_LABEL[ut] ?? ut}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-200 text-left text-xs text-ink-400">
                <tr>
                  <th className="px-3 py-2">GPA(百分制)</th>
                  {schoolTiers.map((t) => (
                    <th key={t} className="px-3 py-2 text-right">
                      {t.toUpperCase()} 院校
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bands.map((b) => (
                  <tr key={b.min} className="border-b border-ink-100 last:border-0">
                    <td className="px-3 py-2 text-ink-700">
                      {b.min} – {b.max >= 100 ? '100' : b.max}
                    </td>
                    {schoolTiers.map((t) => {
                      const v = cell(ut, b.min, t)
                      return (
                        <td key={t} className="px-3 py-2 text-right font-medium text-ink-900">
                          {v ? `${v}%` : <span className="text-ink-300">—</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      <Card>
        <h2 className="mb-2 font-medium text-ink-900">院校档次的实际分布</h2>
        <p className="mb-3 text-sm leading-relaxed text-ink-500">
          规则再准,库里没有项目落在那一档也用不上。档位取自 Program.competitiveness,
          没标注的走代码里的兜底判断(G5 / 港三 / 新二等算 t1,其余 t2)。
        </p>
        <ul className="space-y-1 text-sm text-ink-700">
          {[...tieredPrograms.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([tier, n]) => (
              <li key={tier}>
                {tier} —— {n} 个项目
              </li>
            ))}
        </ul>
        <p className="mt-3 text-xs text-ink-400">
          共 {programCount} 个项目。规则表覆盖的档位:{schoolTiers.join(' / ')}。
          若给某个项目标了表外的档位(如 t3),评估时会就近回退到更难的一档 ——
          偏保守,不会高估录取率。
        </p>
      </Card>

      <Card className="bg-ink-50">
        <h2 className="mb-2 text-sm font-semibold text-ink-900">怎么改</h2>
        <p className="text-sm leading-relaxed text-ink-600">
          概率表在 <code className="rounded bg-white px-1">prisma/seed.ts</code> 里,
          改完跑 <code className="rounded bg-white px-1">npm run db:seed</code>(幂等,只更新概率)。
          校准应当基于真实录取案例,而不是凭感觉调 —— 这也是这一页做成只读的原因。
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          院校档次逐个项目标注:到{' '}
          <Link href="/admin/programs" className="text-brand-600 hover:underline">
            院校库
          </Link>{' '}
          编辑页填「名额紧张度」,只接受 t1 / t2 / t3 / t4。
        </p>
      </Card>
    </div>
  )
}
