import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { Card, Disclaimer } from '@/components/ui'
import { BrandLogo } from '@/components/BrandLogo'
import { ShareCard } from './ShareCard'
import { env } from '@/lib/env'
import { REGION_LABEL, DIRECTION_LABEL, UNDERGRAD_TIER_LABEL } from '@/lib/programs/types'
import { formatDate, daysUntil } from '@/lib/utils'
import { runAssessment } from '@/lib/assessment/engine'
import { getCurrentUser, getActiveSubscription } from '@/lib/auth/session'
import { ImportToShortlist } from './ImportToShortlist'
import type {
  AssessmentResult,
  AssessmentInsights,
  AssessmentInput,
  ProgramMatch,
} from '@/lib/assessment/engine'

/**
 * 评估结果页(PRD 4.1)。
 *
 * ⚠️ 合规红线(PRD 10.1):
 *   · 概率一律带「预估」字样
 *   · 页面底部强制免责声明
 *   · 禁止任何「保录/保offer/100%」表述
 *
 * ⚠️ 洞察部分的每一条都是**对真实采集字段的统计**,不是生成的建议。
 *    没有数据支撑的维度直接不渲染,不用模糊话术填充。
 */

const TIER_META = {
  reach: {
    label: '冲刺',
    desc: '有难度,但值得试',
    accent: 'text-urgent-warning',
    bar: 'bg-urgent-warning',
  },
  match: {
    label: '匹配',
    desc: '与你的背景比较契合',
    accent: 'text-brand-600',
    bar: 'bg-brand-500',
  },
  safe: {
    label: '保底',
    desc: '把握相对较大',
    accent: 'text-safe',
    bar: 'bg-safe',
  },
} as const

const LANGUAGE_BADGE = {
  meets: { text: '语言达标', cls: 'bg-green-50 text-green-700' },
  close: { text: '语言差一点', cls: 'bg-amber-50 text-amber-700' },
  below: { text: '语言未达标', cls: 'bg-red-50 text-red-700' },
  no_score: { text: '', cls: '' },
  unknown: { text: '', cls: '' },
} as const

const TEST_BADGE = {
  required: { text: '需 GMAT/GRE', cls: 'bg-ink-100 text-ink-700' },
  recommended: { text: 'GMAT/GRE 加分', cls: 'bg-ink-100 text-ink-600' },
  not_required: { text: '', cls: '' },
  unspecified: { text: '', cls: '' },
} as const

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-xl font-semibold text-ink-900">{value}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{label}</p>
    </div>
  )
}

function ProgramCard({ m }: { m: ProgramMatch }) {
  const lang = LANGUAGE_BADGE[m.languageStatus]
  const test = TEST_BADGE[m.testRequirement]
  const days = daysUntil(m.finalDeadline)

  return (
    <div className="rounded-lg border border-ink-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{m.schoolName}</p>
          <p className="truncate text-sm text-ink-600">{m.programName}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold text-ink-900">
            {m.probabilityLow}–{m.probabilityHigh}%
          </p>
          <p className="text-xs text-ink-400">预估</p>
        </div>
      </div>

      {/* 关键属性 —— 全部来自官网采集,缺的就不显示 */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
        <span>{REGION_LABEL[m.region]}</span>
        {m.durationMonths && <span>{m.durationMonths} 个月</span>}
        {m.ieltsRequired && <span>雅思 {m.ieltsRequired}</span>}
        {m.tuition && <span className="truncate">{m.tuition}</span>}
      </div>

      {(lang.text || test.text || m.isRolling || days !== null) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {lang.text && (
            <span className={`rounded px-1.5 py-0.5 text-xs ${lang.cls}`}>{lang.text}</span>
          )}
          {test.text && (
            <span className={`rounded px-1.5 py-0.5 text-xs ${test.cls}`}>{test.text}</span>
          )}
          {m.isRolling && (
            <span className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600">
              滚动录取
            </span>
          )}
          {/* 只显示未来的倒计时 —— 过期日期宁可不显示 */}
          {days !== null && days >= 0 && (
            <span className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600">
              {days} 天后截止
            </span>
          )}
        </div>
      )}

      {m.gpaRequirement && (
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink-500">
          {m.gpaRequirement}
        </p>
      )}

      {!m.verified && (
        <p className="mt-2 text-xs text-ink-400">⚠ 该项目数据待人工核对,请以官网为准</p>
      )}
    </div>
  )
}

/** 语言成绩体检 —— 只在确实有可比对数据时渲染 */
function LanguageSection({ ins }: { ins: AssessmentInsights }) {
  const l = ins.language
  if (l.withRequirement === 0) return null

  if (l.type === 'none') {
    return (
      <Card>
        <h2 className="font-medium text-ink-900">语言成绩</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          你还没考语言。这些项目里有 <strong>{l.withRequirement}</strong> 个官网写明了雅思要求,
          区间是 <strong>{l.minRequired} – {l.maxRequired}</strong> 分。
          {l.maxRequired && (
            <> 想把选择面铺满,目标可以定在 {l.maxRequired} 分。</>
          )}
        </p>
        <p className="mt-2 text-xs text-ink-400">
          另有 {ins.dataQuality.verified + ins.dataQuality.unverified - l.withRequirement} 个项目官网未列明雅思要求。
        </p>
      </Card>
    )
  }

  const scoreLabel = l.type === 'ielts' ? '雅思' : '托福'
  return (
    <Card>
      <h2 className="font-medium text-ink-900">
        语言成绩体检
        <span className="ml-2 text-sm font-normal text-ink-500">
          {scoreLabel} {l.userScore}
        </span>
      </h2>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat value={String(l.meets)} label="已达标" />
        <Stat value={String(l.close)} label={l.type === 'ielts' ? '差 0.5 分内' : '差 5 分内'} />
        <Stat value={String(l.below)} label="差距较大" />
      </div>

      {l.close > 0 && (
        <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
          有 {l.close} 个项目你只差一点点 —— 这通常是一次重考能补上的距离,
          值得在递交前再考一次。
        </p>
      )}

      <p className="mt-2 text-xs text-ink-400">
        基于 {l.withRequirement} 个官网写明语言要求的项目统计;
        其余项目官网未列明,未纳入比对。
      </p>
    </Card>
  )
}

/** GMAT/GRE 要求分布 */
function TestingSection({ ins }: { ins: AssessmentInsights }) {
  const t = ins.testing
  const known = t.required + t.recommended + t.not_required
  if (known === 0) return null

  return (
    <Card>
      <h2 className="font-medium text-ink-900">GMAT / GRE</h2>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat value={String(t.required)} label="明确要求" />
        <Stat value={String(t.recommended)} label="建议提交 / 加分" />
        <Stat value={String(t.not_required)} label="不要求" />
      </div>
      {t.required > 0 && (
        <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
          有 {t.required} 个项目明确要求 GMAT/GRE。这类考试通常需要 2-3 个月准备,
          如果这些项目在你的目标里,现在就该排进计划。
        </p>
      )}
      {t.unspecified > 0 && (
        <p className="mt-2 text-xs text-ink-400">
          另有 {t.unspecified} 个项目官网表述不明确,建议直接查官网或问招生办。
        </p>
      )}
    </Card>
  )
}

/** 申请时间线 */
function TimelineSection({ ins }: { ins: AssessmentInsights }) {
  const t = ins.timeline
  if (t.withDeadline === 0 && t.pending === 0) return null

  return (
    <Card>
      <h2 className="font-medium text-ink-900">申请时间</h2>

      {t.nearest ? (
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          最早截止的是 <strong>{t.nearest.schoolName}</strong> {t.nearest.programName},
          {formatDate(t.nearest.date)}
          {daysUntil(t.nearest.date) !== null && (
            <>(还有 {daysUntil(t.nearest.date)} 天)</>
          )}
          。
        </p>
      ) : (
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          你匹配到的项目目前都还没公布 2027 入学的截止日期 —— 多数学校会在 9-10 月陆续放出。
        </p>
      )}

      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat value={String(t.withDeadline)} label="已公布截止日期" />
        <Stat value={String(t.pending)} label="日期待公布" />
        <Stat value={String(t.rolling)} label="滚动录取" />
      </div>

      {t.rolling > 0 && (
        <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
          {t.rolling} 个项目是滚动录取(招满即止)。对这类项目,
          「早交」比「交得完美」更重要 —— 最后一轮的名额通常已经很少。
        </p>
      )}
    </Card>
  )
}

export default async function ResultPage({
  params,
}: {
  params: Promise<{ leadId: string }>
}) {
  const { leadId } = await params
  const lead = await db.lead.findUnique({ where: { id: leadId } })
  if (!lead || !lead.assessResult) notFound()

  const payload = lead.assessPayload as Record<string, unknown>

  /**
   * 会员看到的是完整名单。
   *
   * ⚠️ 之前这一页**完全不看订阅状态** —— 已经付过 ¥1,999 的用户回到评估页,
   *    看到的和免费用户一模一样,底下还挂着「解锁完整系统 ¥1,999 起」。
   *    对刚付完钱的人来说,这是在说「你买的东西没生效」。
   *
   * 归属判断用手机号而不是 leadId:评估是**登录前**做的,那时还没有用户,
   * lead 上也不一定有 convertedUserId。手机号是两边唯一的共同锚点。
   */
  const user = await getCurrentUser()
  const subscription = user ? await getActiveSubscription(user.id) : null
  const isMember = subscription !== null && user!.phone === lead.phone

  // 会员重算一次拿全量;非会员直接用存下来的快照
  const result: AssessmentResult = isMember
    ? await runAssessment(lead.assessPayload as unknown as AssessmentInput, { full: true })
    : (lead.assessResult as unknown as AssessmentResult)

  const ins = result.insights

  /**
   * 分享解锁(PRD 9):每邀请到 1 位完成评估的朋友,多解锁 1 所冲刺档院校。
   *
   * 解锁的是**已经算出来但没展示**的项目,不是临时生成的 ——
   * 所以解锁出来的推荐和付费看到的是同一批数据,没有两套标准。
   */
  const UNLOCK_PER_REFERRAL = 1
  const bonusSlots = Math.min(
    lead.referralCount * UNLOCK_PER_REFERRAL,
    Math.max(0, result.reachPool?.length ?? 0),
  )
  const bonusReach = (result.reachPool ?? []).slice(0, bonusSlots)

  const shown =
    result.reach.length + result.match.length + result.safe.length + bonusReach.length
  const locked = Math.max(0, result.totalMatched - shown)

  const gpaText =
    payload.gpaScale === '4.0' ? `GPA ${payload.gpa}/4.0` : `均分 ${payload.gpa}`

  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <BrandLogo className="text-lg" />

      <h1 className="mt-6 text-2xl font-semibold text-ink-900">你的选校定位</h1>

      {/* 背景回显 —— 让用户确认输入没填错 */}
      <p className="mt-1.5 text-sm text-ink-600">
        {UNDERGRAD_TIER_LABEL[String(payload.undergradTier)]} · {gpaText}
        {payload.languageType !== 'none' && payload.languageScore
          ? ` · ${payload.languageType === 'ielts' ? '雅思' : '托福'} ${payload.languageScore}`
          : ' · 语言未考'}
        {' · '}
        {DIRECTION_LABEL[String(payload.targetDirection)]}
      </p>

      {shown === 0 ? (
        <Card className="mt-6">
          <p className="text-sm leading-relaxed text-ink-600">
            按你填写的条件,我们暂时没有可以给出<strong>有依据</strong>的定位结果 ——
            可能是该地区/方向的数据还在录入中,也可能是你的条件组合比较特殊。
            <br />
            <br />
            我们宁可先不给结论,也不想给你一个编出来的数字。你可以换个方向再试,
            或者直接联系我们人工看一下。
          </p>
        </Card>
      ) : (
        <>
          {/* 匹配概览 */}
          <Card className="mt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium text-ink-900">
                匹配到 {result.totalMatched} 个项目
              </h2>
              <span className="text-xs text-ink-400">
                {ins.regionBreakdown
                  .map((r) => `${REGION_LABEL[r.region]} ${r.count}`)
                  .join(' · ')}
              </span>
            </div>

            {/* 三档分布条 */}
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-ink-100">
              {(['reach', 'match', 'safe'] as const).map((tier) => {
                const count = result[tier].length
                const total = shown || 1
                return (
                  <div
                    key={tier}
                    className={TIER_META[tier].bar}
                    style={{ width: `${(count / total) * 100}%` }}
                  />
                )
              })}
            </div>
            <div className="mt-2 flex gap-4 text-xs text-ink-500">
              {(['reach', 'match', 'safe'] as const).map((tier) => (
                <span key={tier}>
                  <span className={TIER_META[tier].accent}>■</span> {TIER_META[tier].label}{' '}
                  {result[tier].length}
                </span>
              ))}
            </div>
          </Card>

          {/* 三档院校卡片 */}
          <div className="mt-6 space-y-6">
            {(['reach', 'match', 'safe'] as const).map((tier) => {
              const list = result[tier]
              if (!list.length) return null
              const meta = TIER_META[tier]
              return (
                <section key={tier}>
                  <div className="mb-2 flex items-baseline gap-2">
                    <h2 className={`font-semibold ${meta.accent}`}>{meta.label}</h2>
                    <span className="text-xs text-ink-400">{meta.desc}</span>
                  </div>
                  <div className="space-y-2">
                    {list.map((m) => (
                      <ProgramCard key={m.programId} m={m} />
                    ))}

                    {/* 分享解锁的附加院校,只挂在冲刺档下 */}
                    {tier === 'reach' &&
                      bonusReach.map((m) => (
                        <div key={m.programId} className="relative">
                          <span className="absolute -top-2 left-3 z-10 rounded bg-brand-600 px-1.5 py-0.5 text-xs text-white">
                            分享解锁
                          </span>
                          <ProgramCard m={m} />
                        </div>
                      ))}
                  </div>
                </section>
              )
            })}
          </div>

          {/* 数据驱动的洞察 */}
          <div className="mt-6 space-y-4">
            <LanguageSection ins={ins} />
            <TestingSection ins={ins} />
            <TimelineSection ins={ins} />
          </div>

          {/* 分享裂变(PRD 9 P0)。
              候补池本身为空(冲刺档不足 4 所)时不展示 —— 没东西可解锁就别劝人分享;
              池子已全部解锁则仍展示,让用户看到成果。 */}
          {(result.reachPool?.length ?? 0) > 0 && (
            <div className="mt-4">
              <ShareCard
                shareCode={lead.shareCode}
                referralCount={lead.referralCount}
                unlockedCount={bonusReach.length}
                poolRemaining={(result.reachPool?.length ?? 0) - bonusReach.length}
                siteUrl={env.siteUrl}
              />
            </div>
          )}
        </>
      )}

      {/* 付费引导只对没买的人出。已付费还看到「解锁 ¥1,999」等于告诉他钱白花了 */}
      {!isMember && locked > 0 && (
        <Card className="mt-6 border-dashed">
          <p className="font-medium text-ink-900">还有 {locked} 个匹配项目</p>
          <ul className="mt-2 space-y-1 text-sm text-ink-600">
            <li>· 完整院校对比表(录取要求逐项对照)</li>
            <li>· 各校截止日期与申请轮次</li>
            <li>· 按你的选校单自动生成的材料清单</li>
          </ul>
          <Link
            href="/pricing"
            className="mt-4 inline-block rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            解锁完整系统 ¥1,999 起
          </Link>
        </Card>
      )}

      {isMember && shown > 0 && (
        <Card className="mt-6 border-brand-200 bg-brand-50/50">
          <p className="font-medium text-ink-900">
            {subscription!.plan.name} · 已展示全部 {result.totalMatched} 个匹配项目
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ink-600">
            这是完整名单,没有隐藏项。可以整批加进选校单,之后在工作台里逐个跟进 ——
            材料清单会按选校单自动生成。
          </p>
          <div className="mt-4">
            <ImportToShortlist leadId={lead.id} count={shown} />
          </div>
          <p className="mt-3 text-xs text-ink-500">
            已经在选校单里的不会重复添加,档位沿用这里的冲刺 / 匹配 / 保底。
          </p>
        </Card>
      )}

      <div className="mt-6">
        <Disclaimer>
          {result.disclaimer}
          <br />
          <br />
          概率区间由规则引擎基于公开录取数据估算,受当年申请人数、名额变化、
          个人软背景等因素影响,实际结果可能有较大偏差。我们不承诺任何录取结果。
          {ins.dataQuality.unverified > 0 && (
            <>
              <br />
              <br />
              本次匹配的 {result.totalMatched} 个项目中,有 {ins.dataQuality.unverified} 个
              尚未经人工核对,请务必以院校官网为准。
            </>
          )}
        </Disclaimer>
      </div>
    </main>
  )
}
