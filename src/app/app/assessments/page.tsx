import Link from 'next/link'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { formatDate } from '@/lib/utils'
import {
  DIRECTION_LABEL,
  REGION_LABEL,
  UNDERGRAD_TIER_LABEL,
} from '@/lib/programs/types'
import type { AssessmentInput, AssessmentResult } from '@/lib/assessment/engine'
import { Recompute } from './Recompute'
import { ProfileForm } from '../settings/Controls'

/**
 * 我的评估方案。
 *
 * 免费用户一次只能算一份、算完就走。会员可以存多份并排看 ——
 * 「英国金融」和「香港商分」到底哪个组合更稳,这个问题只有并排放着才答得出来。
 *
 * ⚠️ 方案与用户的关联走**手机号**。评估是登录前做的,
 *    Lead 上不一定有 convertedUserId,而且那个字段是 @unique,
 *    一个用户只能占一条 —— 存多份方案必须用手机号。
 */
export default async function AssessmentsPage() {
  const user = await requireUser()

  const profile = await db.profile.findUnique({ where: { userId: user.id } })

  /**
   * 重算的硬性前提(和 recomputeAssessment 里的校验保持一致)。
   * 提前算出来展示,免得用户点了按钮才被告知缺东西。
   */
  const missingForRecompute = [
    !profile?.undergradTier && '本科院校层级',
    profile?.gpa == null && '均分 / GPA',
  ].filter((x): x is string => typeof x === 'string')

  const leads = await db.lead.findMany({
    where: { phone: user.phone, assessResult: { not: undefined } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  const plans = leads
    .filter((l) => l.assessResult !== null)
    .map((l) => {
      const input = l.assessPayload as unknown as AssessmentInput
      const r = l.assessResult as unknown as AssessmentResult
      return {
        id: l.id,
        createdAt: l.createdAt,
        source: l.sourceChannel,
        input,
        total: r.totalMatched,
        reach: r.reach.length,
        match: r.match.length,
        safe: r.safe.length,
        // 洞察里的语言体检 —— 对比时最有用的一项
        langOk: r.insights?.language?.meets ?? null,
        langClose: r.insights?.language?.close ?? null,
      }
    })

  const latest = plans[0]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">我的评估方案</h1>
        <p className="mt-1 text-sm leading-relaxed text-ink-600">
          每做一次评估就存一份。换个地区或方向再算一次,就能并排看哪个组合更稳。
        </p>
      </div>

      {/* 我的背景 —— 从「设置」搬到这里,紧挨着重算,改完立刻能重算 */}
      <Card>
        <h2 className="font-medium text-ink-900">我的背景</h2>
        <p className="mt-1 mb-3 text-sm leading-relaxed text-ink-600">
          用于选校定位和文书合规检查,填得越准结果越靠谱。改完保存后,
          下面就能用最新资料重算。
        </p>

        {/* 完整度提示 —— 别让用户点了「重算」才知道缺什么 */}
        {missingForRecompute.length > 0 ? (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-900">
            还差 <strong>{missingForRecompute.join('、')}</strong> 没填 ——
            补齐后才能用「按我现在的资料重算」。
          </p>
        ) : (
          <p className="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
            背景资料已齐全,可以随时重算。
            {profile?.languageMinBand == null && profile?.languageType === 'ielts' && (
              <span className="text-green-700">
                {' '}补上「最低单项」还能更准 —— 总分够但单项不够的项目会被如实标出来。
              </span>
            )}
          </p>
        )}

        <ProfileForm
          initial={{
            undergradTier: profile?.undergradTier ?? null,
            undergradMajor: profile?.undergradMajor ?? null,
            gpa: profile?.gpa ?? null,
            gpaScale: profile?.gpaScale ?? '100',
            languageType: profile?.languageType ?? null,
            languageScore: profile?.languageScore ?? null,
            languageMinBand: profile?.languageMinBand ?? null,
            isMajorSwitch: profile?.isMajorSwitch ?? false,
          }}
        />

        {/* 目标地区/方向:只读 —— 重算是「同样的目标,我现在能开到什么」,
            换目标属于另一份方案,不能在这里改掉,否则前后就不可比了 */}
        {(profile?.targetRegions?.length || profile?.targetDirection) && (
          <div className="mt-5 border-t border-ink-100 pt-4">
            <p className="text-xs font-medium text-ink-500">当前目标(来自最近一次评估)</p>
            <p className="mt-1.5 text-sm text-ink-800">
              {(profile.targetRegions ?? []).map((r) => REGION_LABEL[r] ?? r).join('、') || '—'}
              {profile.targetDirection && (
                <span className="text-ink-500">
                  {' · '}
                  {DIRECTION_LABEL[profile.targetDirection] ?? profile.targetDirection}
                </span>
              )}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-400">
              重算会沿用这个目标 —— 换了地区或方向就不是同一件事的对比了。
              想比较不同组合,
              <Link href="/assess" className="text-brand-600 hover:underline">
                新做一份评估
              </Link>
              ,两份会并排出现在下面的表里。
            </p>
          </div>
        )}
      </Card>

      {plans.length === 0 ? (
        <Card>
          <p className="text-sm leading-relaxed text-ink-600">
            还没有评估记录。
            <Link href="/assess" className="ml-1 text-brand-600 hover:underline">
              去做一次 →
            </Link>
          </p>
        </Card>
      ) : (
        <>
          {latest && (
            <Card>
              <h2 className="font-medium text-ink-900">背景变了?重算看看</h2>
              <p className="mt-1 mb-3 text-sm leading-relaxed text-ink-600">
                语言考出来了、均分变了之后,先在上面「我的背景」里改好并保存,
                再点这里重算一份,系统会告诉你多够得着哪些学校。旧方案不会被覆盖。
              </p>
              <Recompute leadId={latest.id} />
            </Card>
          )}

          <section>
            <h2 className="mb-3 font-medium text-ink-900">
              方案对比
              <span className="ml-2 text-sm font-normal text-ink-400">{plans.length} 份</span>
            </h2>

            <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-xs text-ink-500">
                    <th className="px-4 py-2.5 font-medium">方案</th>
                    <th className="px-3 py-2.5 font-medium">地区 / 方向</th>
                    <th className="px-3 py-2.5 font-medium">匹配</th>
                    <th className="px-3 py-2.5 font-medium">冲 / 匹 / 保</th>
                    <th className="px-3 py-2.5 font-medium">语言</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p, i) => (
                    <tr key={p.id} className={i > 0 ? 'border-t border-ink-100' : ''}>
                      <td className="px-4 py-3">
                        <p className="text-ink-900">{formatDate(p.createdAt)}</p>
                        <p className="text-xs text-ink-400">
                          {i === 0 ? '最新' : ''}
                          {p.source === 'recompute' ? ' · 重算' : ''}
                          {p.source === 'variant' ? ' · 变体' : ''}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-ink-700">
                        <p>
                          {(p.input.targetRegions ?? [])
                            .map((r) => REGION_LABEL[r] ?? r)
                            .join('、') || '—'}
                        </p>
                        <p className="text-xs text-ink-500">
                          {DIRECTION_LABEL[p.input.targetDirection] ?? p.input.targetDirection}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-lg font-semibold text-ink-900">{p.total}</span>
                      </td>
                      <td className="px-3 py-3 text-ink-700">
                        {p.reach} / {p.match} /{' '}
                        <span className={p.safe === 0 ? 'text-urgent-warning' : ''}>{p.safe}</span>
                      </td>
                      <td className="px-3 py-3 text-xs text-ink-600">
                        {p.input.languageType && p.input.languageType !== 'none'
                          ? `${p.input.languageType === 'ielts' ? '雅思' : '托福'} ${p.input.languageScore}`
                          : '未考'}
                        {p.langOk != null && (
                          <span className="block text-ink-400">达标 {p.langOk} 所</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Link
                          href={`/assess/result/${p.id}`}
                          className="text-xs whitespace-nowrap text-brand-600 hover:underline"
                        >
                          查看 →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {plans.some((p) => p.safe === 0) && (
              <p className="mt-2 text-xs leading-relaxed text-ink-500">
                「保 = 0」的方案值得留意:全是冲刺和匹配意味着最坏情况下可能没学上。
                换个地区或方向再算一份对比看看。
              </p>
            )}
          </section>

          <Card className="bg-ink-50">
            <p className="text-xs leading-relaxed text-ink-600">
              想加一份新方案?回{' '}
              <Link href="/assess" className="underline">
                免费评估
              </Link>{' '}
              用同一个手机号换个地区或方向再做一次,新方案会自动出现在这张表里。
              <br />
              进到某一份方案里,可以把它的推荐名单整批加进选校单。
            </p>
          </Card>
        </>
      )}
    </div>
  )
}
