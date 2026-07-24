'use client'

import { Suspense, useState, useTransition, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button, Field, RadioGroup } from '@/components/ui'
import { BrandLogo } from '@/components/BrandLogo'
import { submitAssessment, trackAssessStart, getAvailableRegions } from './actions'
import type { AssessFormInput } from './actions'
import {
  DIRECTION_LABEL,
  DIRECTION_ORDER,
  REGION_LABEL,
  REGION_ORDER,
} from '@/lib/programs/types'
import { UNDERGRAD_DISCIPLINES } from '@/lib/programs/undergrad-catalog'
import { MajorPicker } from '@/components/MajorPicker'

/**
 * 免费评估 3 步表单(PRD 4.1)。
 * 每步 ≤3 个字段,移动端每步一屏 —— 目标是 60 秒内完成。
 */

const TIER_OPTIONS = [
  { value: 'c985_211' as const, label: '985 / 211' },
  { value: 'double_non_first' as const, label: '双非一本' },
  { value: 'tier_two_other' as const, label: '二本及其他' },
  { value: 'overseas' as const, label: '海外本科' },
]


type DirectionValue = (typeof DIRECTION_ORDER)[number]
type DirectionOption = {
  value: DirectionValue
  label: string
  description: string
}

const LANG_OPTIONS = [
  { value: 'ielts' as const, label: '雅思' },
  { value: 'toefl' as const, label: '托福' },
  { value: 'none' as const, label: '还没考' },
]

const DIRECTION_OPTIONS: DirectionOption[] = [
  { value: 'finance', label: 'Finance', description: '金融 / 投资 / 风控' },
  { value: 'accounting', label: 'Accounting', description: '会计 / 审计 / 税务' },
  { value: 'management', label: 'Management', description: '管理 / 战略 / 创业' },
  { value: 'marketing', label: 'Marketing', description: '市场 / 品牌 / 消费者' },
  { value: 'business_analytics', label: 'Business Analytics', description: '商业分析 / 管理科学' },
  { value: 'economics', label: 'Economics', description: '经济学 / 计量经济' },
  { value: 'international_business', label: 'International Business', description: '国际商务 / 全球管理' },
  { value: 'supply_chain', label: 'Supply Chain & Operations', description: '供应链 / 运营 / 物流' },
  { value: 'hr', label: 'Human Resource Management', description: '人力资源 / 组织行为' },
  { value: 'computer_science', label: 'Computer Science', description: '计算机 / 软件工程' },
  { value: 'data_science_ai', label: 'Data Science & AI', description: '数据科学 / 人工智能' },
  { value: 'engineering', label: 'Engineering & Technology', description: '工程 / 技术管理' },
  { value: 'architecture', label: 'Architecture & Built Env.', description: '建筑 / 城市 / 房地产' },
  { value: 'mathematics_statistics', label: 'Mathematics & Statistics', description: '数学 / 统计 / 运筹' },
  { value: 'natural_sciences', label: 'Natural Sciences', description: '物理 / 化学 / 地球科学' },
  { value: 'life_sciences_medicine', label: 'Life Sciences & Medicine', description: '生命科学 / 医学 / 健康' },
  { value: 'social_sciences', label: 'Social Sciences', description: '社会学 / 心理 / 政治' },
  { value: 'media_communication', label: 'Media & Communication', description: '传媒 / 新闻 / 公关' },
  { value: 'law_public_policy', label: 'Law & Public Policy', description: '法律 / 公共政策' },
  { value: 'education', label: 'Education', description: '教育 / TESOL' },
  { value: 'arts_design', label: 'Arts & Design', description: '艺术 / 设计 / 时尚' },
  { value: 'humanities', label: 'Humanities', description: '语言 / 历史 / 哲学' },
  { value: 'environment_sustainability', label: 'Environment & Sustainability', description: '环境 / 可持续发展' },
  { value: 'agriculture_food_science', label: 'Agriculture & Food Science', description: '农业 / 食品科学' },
  { value: 'hospitality_tourism', label: 'Hospitality & Tourism', description: '酒店 / 旅游 / 会展' },
  { value: 'public_health', label: 'Public Health', description: '公共卫生 / 健康政策' },
  { value: 'other', label: 'Other / Interdisciplinary', description: '其他 / 跨学科' },
]


/** 专业类名 / 门类名 → 所属门类(含方向映射)。找不到返回 null。 */
function disciplineOf(major?: string | null) {
  if (!major) return null
  return (
    UNDERGRAD_DISCIPLINES.find(
      (d) => d.name === major || d.categories.some((c) => c.name === major),
    ) ?? null
  )
}

function getMajorLabel(major?: string | null) {
  if (!major) return '还没选本科专业'
  const d = disciplineOf(major)
  // 专业类:显示「金融学类 · 经济学」;门类本身或"其他":直接显示
  return d && d.name !== major ? `${major} · ${d.name}` : major
}

function getDirectionName(direction?: string | null) {
  return direction ? (DIRECTION_LABEL[direction] ?? direction) : '还没圈定方向'
}

function directionGroupsFor(major?: string | null) {
  const relation = disciplineOf(major)
  if (!relation) {
    return [
      {
        title: '全部申请方向',
        body: '先在第 1 步选择本科门类后,这里会按你的起点重新排序。',
        options: DIRECTION_OPTIONS,
      },
    ]
  }

  const used = new Set<DirectionValue>()
  const pick = (values: DirectionValue[]) =>
    values
      .map((value) => DIRECTION_OPTIONS.find((option) => option.value === value))
      .filter((option): option is DirectionOption => {
        if (!option || used.has(option.value)) return false
        used.add(option.value)
        return true
      })

  const primary = pick(relation.primary)
  const adjacent = pick(relation.adjacent)
  const rest = DIRECTION_OPTIONS.filter((option) => !used.has(option.value))

  return [
    {
      title: '和你的本科起点最顺',
      body: '课程背景通常衔接更自然,适合作为主申请线。',
      options: primary,
    },
    {
      title: '常见转向',
      body: '需要解释动机或补充技能,但在申请里比较常见。',
      options: adjacent,
    },
    {
      title: '跨学科 / 其他方向',
      body: '跨度更大,建议后续重点看先修课、作品集或实习要求。',
      options: rest,
    },
  ].filter((group) => group.options.length > 0)
}

const STEP_META = [
  {
    n: '01',
    label: '起点',
    title: '先把你的申请坐标定住',
    body: '学校层级和专业背景决定第一层筛选。别急着自我否定,先把你站在哪里说清楚。',
  },
  {
    n: '02',
    label: '实力',
    title: '把分数放回它该在的位置',
    body: '均分和语言很重要,但它们不是全部。我们会把可冲、可稳、该谨慎分开呈现。',
  },
  {
    n: '03',
    label: '野心',
    title: '告诉我你想把履历投向哪里',
    body: '从你的本科起点出发,先看顺延方向,再看常见转向。结果保存到手机号,之后可以继续回来调整。',
  },
]

const NEXT_LABEL: Record<number, string> = {
  1: '继续,看实力区间',
  2: '继续,圈定申请地图',
}

type Draft = Partial<AssessFormInput>

/**
 * ⚠️ useSearchParams() 必须包在 Suspense 里,否则 `next build` 直接失败。
 *    这个错只有生产构建会报,`next dev` 一切正常 —— 见 src/app/login/page.tsx 的同类说明。
 */
export default function AssessPage() {
  return (
    <Suspense fallback={null}>
      <AssessForm />
    </Suspense>
  )
}

function AssessForm() {
  const router = useRouter()
  const params = useSearchParams()
  const sourceChannel = params.get('ch')
  /** 分享裂变归因码,由 /r/{shareCode} 落地页带过来 */
  const referralCode = params.get('ref')

  const [step, setStep] = useState(1)
  const [d, setD] = useState<Draft>({ gpaScale: '100', gpa: 82, targetRegions: [] })
  const [error, setError] = useState<string | null>(null)
  const [showAllDirections, setShowAllDirections] = useState(false)
  const [pending, startTransition] = useTransition()

  // 服务端返回全部支持的地区(可选的排前面),这里直接用
  const [regions, setRegions] = useState<
    Array<{ region: string; count: number; available: boolean }>
  >([])
  const [regionsLoaded, setRegionsLoaded] = useState(false)

  useEffect(() => {
    void trackAssessStart(sourceChannel)
    void getAvailableRegions()
      .then((rs) => setRegions(rs))
      .finally(() => setRegionsLoaded(true))
  }, [sourceChannel])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }))

  function setUndergradMajor(v: NonNullable<Draft['undergradMajor']>) {
    setD((p) => ({ ...p, undergradMajor: v, targetDirection: undefined }))
    setShowAllDirections(false)
  }

  const directionGroups = directionGroupsFor(d.undergradMajor)
  const hiddenDirectionGroup =
    directionGroups.find((group) => group.title === '跨学科 / 其他方向') ?? null
  const visibleDirectionGroups = showAllDirections
    ? directionGroups
    : directionGroups.filter((group) => group.title !== '跨学科 / 其他方向')

  const canNext =
    step === 1
      ? !!d.undergradTier && !!d.undergradMajor
      : step === 2
        ? d.gpa != null && !!d.languageType && (d.languageType === 'none' || d.languageScore != null)
        : !!d.targetRegions?.length &&
          !!d.targetDirection &&
          d.phone?.length === 11 &&
          d.agreedPrivacy

  const progress = Math.round((step / 3) * 100)
  const selectedRegions =
    d.targetRegions?.map((region) => REGION_LABEL[region] ?? region).join(' / ') || '还没选地区'
  const languageSummary =
    d.languageType === 'none'
      ? '语言还没考'
      : d.languageType && d.languageScore
        ? `${d.languageType === 'ielts' ? '雅思' : '托福'} ${d.languageScore}${
            d.languageMinBand ? ` · 最低单项 ${d.languageMinBand}` : ''
          }`
        : '还没填语言'
  const mapRows = [
    { label: '本科起点', value: d.undergradMajor ? getMajorLabel(d.undergradMajor) : '先选本科门类' },
    { label: '成绩信号', value: d.gpaScale === '4.0' ? `${d.gpa ?? 3.2}/4.0` : `${d.gpa ?? 82} 分` },
    { label: '语言状态', value: languageSummary },
    { label: '目标地区', value: selectedRegions },
    { label: '申请方向', value: getDirectionName(d.targetDirection) },
  ]

  function handleSubmit() {
    setError(null)
    startTransition(async () => {
      const res = await submitAssessment({ ...d, sourceChannel, referralCode })
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.push(`/assess/result/${res.leadId}`)
    })
  }

  return (
    <main className="marketing-page min-h-screen bg-[#fff9fc] text-ink-800">
      <header className="sticky top-0 z-30 border-b border-white/70 bg-white/78 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <BrandLogo className="text-lg" />
          <span className="hidden text-sm text-ink-500 sm:inline">60 秒生成你的申请地图</span>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-white/70 bg-[linear-gradient(180deg,#fff7fb_0%,#ffffff_48%,#f6fbff_100%)]">
        <div className="absolute inset-x-0 top-0 h-40 bg-[linear-gradient(90deg,rgba(247,119,55,0.12),rgba(225,48,108,0.10),rgba(59,130,246,0.10))]" />
        <div className="relative mx-auto grid max-w-7xl gap-6 px-5 py-6 lg:grid-cols-[0.82fr_1.18fr] lg:py-10">
          <aside className="lg:sticky lg:top-8 lg:self-start">
            <div className="overflow-hidden rounded-lg border border-white/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(255,246,251,0.92)_48%,rgba(244,250,255,0.94))] text-ink-800 shadow-[0_24px_70px_rgba(225,48,108,0.10)] backdrop-blur-xl">
              <div className="relative border-b border-ink-100/70 p-5">
                <div className="absolute inset-x-0 top-0 h-1 insta-gradient" />
                <p className="gradient-text text-sm font-semibold">APPLICATION MAP</p>
                <h1 className="display-heading mt-3 text-3xl font-semibold text-ink-950 sm:text-4xl">
                  不是填表,
                  <br />
                  是在画你的申请地图
                </h1>
                <p className="mt-4 text-sm leading-relaxed text-ink-500">
                  每回答一步,下面这张地图都会变得更清楚。先定位,再看实力,最后圈定地区和方向。
                </p>
              </div>

              <div className="p-5">
                <div className="rounded-lg border border-ink-100 bg-white/80 p-4 shadow-[0_12px_32px_rgba(35,42,53,0.05)]">
                  <div className="flex items-center justify-between text-xs text-ink-500">
                    <span>地图完成度</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-100">
                    <div className="insta-gradient h-full rounded-full" style={{ width: `${progress}%` }} />
                  </div>
                </div>

                <div className="mt-4 grid gap-2">
                  {mapRows.map((row) => (
                    <div
                      key={row.label}
                      className="rounded-lg border border-ink-100 bg-white/75 px-3 py-2.5 shadow-[0_10px_24px_rgba(35,42,53,0.04)]"
                    >
                      <p className="text-[11px] font-medium text-ink-400">{row.label}</p>
                      <p className="mt-1 line-clamp-2 text-sm leading-snug text-ink-800">{row.value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-5 space-y-2">
                {STEP_META.map((item, index) => (
                  <button
                    key={item.n}
                    type="button"
                    onClick={() => setStep(index + 1)}
                    className={`flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${
                      step === index + 1
                        ? 'border-brand-200 bg-white text-ink-900 shadow-[0_14px_36px_rgba(225,48,108,0.14)]'
                        : 'border-ink-100 bg-white/60 text-ink-600 hover:border-brand-100 hover:bg-white'
                    }`}
                  >
                    <span className="story-ring mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full p-[2px] text-xs font-semibold">
                      <span className="grid h-full w-full place-items-center rounded-full bg-white text-ink-900">
                        {item.n}
                      </span>
                    </span>
                    <span>
                      <span className="block text-sm font-medium">{item.label}</span>
                      <span
                        className={`mt-0.5 block text-xs leading-relaxed ${
                          step === index + 1 ? 'text-ink-500' : 'text-ink-400'
                        }`}
                      >
                        {item.body}
                      </span>
                    </span>
                  </button>
                ))}
                </div>
              </div>
            </div>
          </aside>

          <div className="overflow-hidden rounded-lg border border-white/80 bg-white shadow-[0_22px_60px_rgba(35,42,53,0.08)]">
            <div className="border-b border-ink-100 bg-white px-5 py-5 sm:px-7">
              <div className="mb-5 flex items-center gap-2">
                {[1, 2, 3].map((s) => (
                  <div
                    key={s}
                    className={`h-2 flex-1 rounded-full ${
                      s <= step ? 'insta-gradient' : 'bg-ink-100'
                    }`}
                  />
                ))}
                <span className="ml-2 text-xs text-ink-400">{step}/3</span>
              </div>
              <p className="gradient-text text-sm font-semibold">问题 {STEP_META[step - 1].n}</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink-900">
                {STEP_META[step - 1].title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-500">
                {STEP_META[step - 1].body}
              </p>
            </div>

            <div className="px-5 py-6 sm:px-7 sm:py-7">
              {step === 1 && (
                <div className="space-y-6">
                  <Field
                    label="你的本科背景,更接近哪条起跑线"
                    hint="不确定也没关系,先选最接近的一档。结果出来后还能回头改。"
                  >
                    <RadioGroup
                      options={TIER_OPTIONS}
                      value={d.undergradTier ?? null}
                      onChange={(v) => set('undergradTier', v)}
                    />
                  </Field>
                  <Field
                    label="你的本科专业"
                    hint="按教育部《本科专业目录》的学科门类 + 专业类来选,或直接搜关键词。选最接近的一项即可。"
                  >
                    <MajorPicker value={d.undergradMajor ?? null} onChange={setUndergradMajor} />
                  </Field>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-6">
                  <Field label="现在这份成绩单,大概写着多少" hint="填当前成绩就好。申请季里,分数本来就是一边推进一边更新的。">
                    <div className="mb-4 inline-flex rounded-lg border border-ink-100 bg-ink-50 p-1">
                      <button
                        type="button"
                        onClick={() => setD((p) => ({ ...p, gpaScale: '100', gpa: 82 }))}
                        className={`rounded px-3 py-1.5 text-xs font-medium ${
                          d.gpaScale === '100'
                            ? 'insta-gradient text-white'
                            : 'text-ink-500 hover:text-ink-900'
                        }`}
                      >
                        百分制
                      </button>
                      <button
                        type="button"
                        onClick={() => setD((p) => ({ ...p, gpaScale: '4.0', gpa: 3.2 }))}
                        className={`rounded px-3 py-1.5 text-xs font-medium ${
                          d.gpaScale === '4.0'
                            ? 'insta-gradient text-white'
                            : 'text-ink-500 hover:text-ink-900'
                        }`}
                      >
                        4 分制
                      </button>
                    </div>
                    <input
                      type="range"
                      min={d.gpaScale === '100' ? 70 : 2}
                      max={d.gpaScale === '100' ? 95 : 4}
                      step={d.gpaScale === '100' ? 1 : 0.1}
                      value={d.gpa ?? 82}
                      onChange={(e) => set('gpa', Number(e.target.value))}
                      className="w-full accent-brand-600"
                    />
                    <div className="mt-3 rounded-lg bg-ink-50 px-4 py-4 text-center">
                      <span className="text-3xl font-semibold text-ink-900">
                        {d.gpaScale === '100' ? d.gpa : (d.gpa ?? 3.2).toFixed(1)}
                      </span>
                      <span className="ml-2 text-sm text-ink-400">
                        {d.gpaScale === '100' ? '分' : '/ 4.0'}
                      </span>
                    </div>
                  </Field>

                  <Field label="语言成绩到了哪一步" hint="还没考也可以继续。结果页会把需要补的门槛单独拎出来。">
                    <RadioGroup
                      options={LANG_OPTIONS}
                      value={d.languageType ?? null}
                      onChange={(v) => set('languageType', v)}
                      columns={1}
                    />
                    {d.languageType && d.languageType !== 'none' && (
                      <>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <input
                            type="number"
                            step="0.5"
                            value={d.languageScore ?? ''}
                            onChange={(e) => set('languageScore', Number(e.target.value))}
                            placeholder={d.languageType === 'ielts' ? '总分 如 6.5' : '总分 如 95'}
                            className="w-full rounded-lg border border-ink-200 px-3 py-3 text-sm outline-none focus:border-brand-500"
                          />
                          <input
                            type="number"
                            step="0.5"
                            value={d.languageMinBand ?? ''}
                            onChange={(e) =>
                              set(
                                'languageMinBand',
                                e.target.value ? Number(e.target.value) : null,
                              )
                            }
                            placeholder={d.languageType === 'ielts' ? '最低单项 如 6.0' : '最低单项'}
                            className="w-full rounded-lg border border-ink-200 px-3 py-3 text-sm outline-none focus:border-brand-500"
                          />
                        </div>
                        {d.languageType === 'ielts' && (
                          <p className="mt-2 text-xs leading-relaxed text-ink-500">
                            很多学校要求「总分 6.5 且<strong>单项不低于 6.0</strong>」。
                            填上最低那一项,我们才不会把实际会拒你的项目标成「达标」。不填也能继续。
                          </p>
                        )}
                      </>
                    )}
                  </Field>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-6">
                  <Field label="你想把申请投向哪些地方" hint="美国之外的主流英语授课地区都在这里。标「即将开放」的正在核对数据,暂不可选。右侧数字是当前收录的项目数。">
                    <div className="grid grid-cols-2 gap-2">
                      {regions.map((r) => {
                        const value = r.region as NonNullable<Draft['targetRegions']>[number]
                        const on = d.targetRegions?.includes(value)
                        // 未开放/无数据:显示但禁用 —— 让用户看到完整版图,又不会选到空地区
                        if (!r.available) {
                          return (
                            <div
                              key={r.region}
                              className="flex min-h-11 cursor-not-allowed items-center justify-between gap-2 rounded-lg border border-dashed border-ink-200 bg-ink-50/60 px-3 py-2.5 text-sm text-ink-400"
                              title="正在核对院校数据,开放后即可选择"
                            >
                              <span>{REGION_LABEL[r.region] ?? r.region}</span>
                              <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-500">
                                即将开放
                              </span>
                            </div>
                          )
                        }
                        return (
                          <button
                            key={r.region}
                            type="button"
                            onClick={() =>
                              set(
                                'targetRegions',
                                on
                                  ? d.targetRegions!.filter((x) => x !== value)
                                  : [...(d.targetRegions ?? []), value],
                              )
                            }
                            className={`flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                              on
                                ? 'border-insta-pink bg-brand-50 text-brand-700'
                                : 'border-ink-200 bg-white text-ink-600 hover:border-ink-400'
                            }`}
                          >
                            <span>{REGION_LABEL[r.region] ?? r.region}</span>
                            <span className="text-xs text-ink-400">{r.count}</span>
                          </button>
                        )
                      })}
                    </div>
                    {regionsLoaded && regions.every((r) => !r.available) && (
                      // 一个地区都还没开放:如实说明
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                        <p className="text-sm leading-relaxed text-amber-900">
                          上面这些是我们覆盖的目的地,但都还在核对数据 ——
                          只有核对完的地区才会开放,宁可先不开放,也不拿没核对过的数字给你做决定。
                        </p>
                      </div>
                    )}
                  </Field>

                  <Field
                    label="从你的本科起点出发,你想申请哪个方向"
                    hint="已按第 1 步的本科门类排序。顺延更稳,转向要重点看先修课、作品集或实习证据。"
                  >
                    <div className="mb-3 rounded-lg border border-brand-100 bg-brand-50/70 px-3 py-2 text-xs leading-relaxed text-brand-700">
                      你的起点: {getMajorLabel(d.undergradMajor)}
                    </div>
                    <div className="space-y-4">
                      {visibleDirectionGroups.map((group) => (
                        <section key={group.title}>
                          <div className="mb-2">
                            <p className="text-xs font-semibold text-ink-700">{group.title}</p>
                            <p className="mt-0.5 text-xs leading-relaxed text-ink-400">
                              {group.body}
                            </p>
                          </div>
                          <RadioGroup
                            options={group.options}
                            value={d.targetDirection ?? null}
                            onChange={(v) => set('targetDirection', v)}
                          />
                        </section>
                      ))}
                      {hiddenDirectionGroup && (
                        <button
                          type="button"
                          onClick={() => setShowAllDirections((open) => !open)}
                          className="inline-flex min-h-11 items-center rounded-lg border border-dashed border-ink-200 bg-white px-3 text-sm font-medium text-ink-600 transition-colors hover:border-insta-pink hover:text-insta-pink"
                        >
                          {showAllDirections
                            ? '收起跨学科方向'
                            : `查看更多跨学科方向(${hiddenDirectionGroup.options.length})`}
                        </button>
                      )}
                    </div>
                  </Field>

                  <Field label="把这次测评结果存到哪里" hint="手机号只用于保存和找回结果,不会向第三方出售。">
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={d.phone ?? ''}
                      onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 11))}
                      placeholder="11 位手机号"
                      className="w-full rounded-lg border border-ink-200 px-3 py-3 text-sm outline-none focus:border-brand-500"
                    />
                  </Field>

                  <label className="flex items-start gap-2 rounded-lg bg-ink-50 px-3 py-3 text-xs leading-relaxed text-ink-600">
                    <input
                      type="checkbox"
                      checked={!!d.agreedPrivacy}
                      onChange={(e) => set('agreedPrivacy', e.target.checked as true)}
                      className="mt-0.5"
                    />
                    <span>
                      我同意 Compass 存储上述信息,用于生成和找回这次选校评估,并同意
                      <Link
                        href="/legal/privacy"
                        target="_blank"
                        className="text-brand-600 hover:underline"
                      >
                        《隐私政策》
                      </Link>
                      。
                    </span>
                  </label>
                </div>
              )}

              {error && (
                <p className="mt-5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}

              <div className="mt-7 flex gap-2">
                {step > 1 && (
                  <Button variant="secondary" onClick={() => setStep(step - 1)} disabled={pending}>
                    上一步
                  </Button>
                )}
                {step < 3 ? (
                  <Button
                    onClick={() => setStep(step + 1)}
                    disabled={!canNext}
                    className="insta-button flex-1 border-0"
                  >
                    {NEXT_LABEL[step]}
                  </Button>
                ) : (
                  <Button
                    onClick={handleSubmit}
                    disabled={!canNext || pending}
                    className="insta-button flex-1 border-0"
                  >
                    {pending ? '正在整理你的申请快照...' : '生成我的申请快照'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        <p className="mx-auto max-w-7xl px-5 pb-8 text-center text-xs leading-relaxed text-ink-400">
          这是一份基于公开信息和规则模型的申请参考,不是录取承诺。最终要求和截止日期,永远以学校官网为准。
        </p>
      </section>
    </main>
  )
}
