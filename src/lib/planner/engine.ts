import 'server-only'
import type { Prisma, DeadlineAudience } from '@prisma/client'
import { db } from '@/lib/db'
import { daysUntil } from '@/lib/utils'
import { countdownDeadline } from '@/lib/programs/deadline'
import { readRequirements, parseMinBandRequirement } from '@/lib/programs/types'

/**
 * 行动引擎:把「一堆数字和列表」变成「今天该做的三件事」。
 *
 * ── 为什么不用模型 ──────────────────────────────────────
 * 和定位引擎(PRD 4.1)同一个道理:
 *   · 排序理由必须能说清楚。用户问「为什么推荐信排第一」,答案得是
 *     「因为推荐人平均要 6 周,而你最近的截止日只剩 41 天」,
 *     不能是「模型觉得重要」。
 *   · 每次打开工作台都要算一次。规则是免费的、几毫秒的、结果稳定的;
 *     模型是要花钱的、要等的、同样输入可能给出不同排序的。
 *   · 这里的输入全是结构化数据(截止日、材料状态、语言分),
 *     本来就不需要理解自然语言。
 *
 * AI 真正该出现的地方是文书 —— 那里需要理解和生成,已经做了。
 *
 * ── 焦虑管理(PRD 14)────────────────────────────────────
 * 只说事实和可执行的下一步,不用「再不做就来不及了」这类话。
 * 一次最多给 3 条行动,给多了等于没给。
 */

export type ActionKind =
  | 'no_schools'
  | 'no_safe'
  | 'language_gap'
  | 'material'
  | 'essay'
  | 'submit'
  | 'expired'

export interface Action {
  kind: ActionKind
  title: string
  /** 为什么是这件事 —— 必须能说清楚,这是规则驱动的意义所在 */
  why: string
  href: string
  cta: string
  /** 分数越高越靠前,仅内部排序用 */
  score: number
}

export interface Risk {
  level: 'warn' | 'info'
  title: string
  detail: string
}

export interface ActionPlan {
  actions: Action[]
  risks: Risk[]
  /** 最近一个截止日还有几天,null 表示都没公布 */
  nearestDays: number | null
}

/** 语言成绩换算不了的情况下,用于判断「差多少」。导出仅为可测 */
export function languageGap(
  userType: string | null,
  userScore: number | null,
  req: ReturnType<typeof readRequirements>,
): number | null {
  if (!userType || userScore == null) return null
  if (userType === 'ielts' && req.ielts?.overall) return req.ielts.overall - userScore
  if (userType === 'toefl' && req.toefl?.overall) return req.toefl.overall - userScore
  return null
}

export interface LanguageShortfall {
  /** 差多少分 —— 总分缺口与单项缺口里更大的那个 */
  gap: number
  /** 缺口来自单项(而不是总分)。文案必须说出来,否则学生会以为刷总分就行 */
  fromBand: boolean
}

/**
 * 这所学校的语言要求,学生差多少。**总分和单项都要看。**
 *
 * ⚠️ 只比总分会给出错误的「达标」结论:总分 7.0 但写作 5.5 的学生,
 *    申请「单项不低于 6.0」的项目一定被拒。schema 在
 *    Profile.languageMinBand 上就写着这句话,测评引擎也照做了并注明
 *    「这是最需要修的一类错误」—— 但行动计划此前只比 overall,
 *    连 languageMinBand 都没进 PlannerProfile。
 *    结果是同一个学生:测评页说不达标,工作台一句不提、不催他重考。
 *    院校库里 61% 的项目写明了单项要求,这不是边角情况。
 *
 * ⚠️ 单项只对雅思生效,和测评引擎保持一致 —— 托福单项要求的写法差异太大,
 *    硬套会解析出错误的门槛,那比不判更糟。
 *
 * 返回 null = 没有可判定的缺口(要求没写、学生没成绩、或已达标)。
 */
export function languageShortfall(
  userType: string | null,
  userScore: number | null,
  userMinBand: number | null,
  req: ReturnType<typeof readRequirements>,
): LanguageShortfall | null {
  const overallGap = languageGap(userType, userScore, req)

  let bandGap: number | null = null
  if (userType === 'ielts' && userMinBand != null) {
    const required = parseMinBandRequirement(req.ielts?.subscores)
    // 解析不出要求、或学生没填单项时都不判 —— 不猜
    if (required != null) bandGap = required - userMinBand
  }

  const candidates: Array<{ gap: number; fromBand: boolean }> = []
  if (overallGap != null && overallGap > 0) candidates.push({ gap: overallGap, fromBand: false })
  if (bandGap != null && bandGap > 0) candidates.push({ gap: bandGap, fromBand: true })
  if (!candidates.length) return null

  // 缺口大的那个决定「差多少」;两边一样大时算作单项,因为那更难补
  return candidates.reduce((a, b) => (b.gap > a.gap || (b.gap === a.gap && b.fromBand) ? b : a))
}

/**
 * planActions 需要的最小输入形状。
 *
 * 刻意不直接用 Prisma 生成的类型:一是测试要能手搓数据,二是这层本来就
 * 只依赖这几个字段,写清楚比 `include` 出来的一大坨更能说明它到底看什么。
 */
export interface PlannerChoice {
  programId: string
  status: string
  tierTag: string
  program: {
    finalDeadline: Date | string | null
    /**
     * 截止日适用于哪类申请人。**必填**,不给默认值 ——
     * 给了默认值就等于允许调用方「忘了传」,而忘了传的后果是
     * 拿一个可能不适用的日期去催学生。见 lib/programs/deadline.ts。
     */
    deadlineAudience: DeadlineAudience
    isRolling: boolean
    requirements: Prisma.JsonValue
    school: { nameZh: string | null; nameEn: string }
  }
}
export interface PlannerMaterial {
  status: string
  programIds: string[]
  template: { name: string; leadTimeDays: number }
}
export interface PlannerEssay {
  status: string
  programId: string | null
}
export interface PlannerProfile {
  languageType: string | null
  languageScore: number | null
  /**
   * 学生的**最低单项**(雅思小分)。
   * 必填(可为 null),不给默认值 —— 默认值等于允许调用方忘了传,
   * 而忘了传的后果是又退回「只比总分」那个错误结论。
   */
  languageMinBand: number | null
}

export async function buildActionPlan(userId: string): Promise<ActionPlan> {
  const [choices, materials, essays, profile] = await Promise.all([
    db.userSchoolChoice.findMany({
      where: { userId },
      include: { program: { include: { school: true } } },
    }),
    db.userMaterial.findMany({
      where: { userId },
      include: { template: true },
    }),
    db.essay.findMany({ where: { userId } }),
    db.profile.findUnique({ where: { userId } }),
  ])

  return planActions({ choices, materials, essays, profile })
}

/**
 * 排序与文案的全部逻辑 —— 纯函数,不碰数据库。
 *
 * ⚠️ 从 buildActionPlan 里原样抽出来的,一行逻辑都没改。
 *    抽出来的理由:决定「今天该做哪三件事」的是这里的 score 公式,
 *    它是这个产品对用户的核心承诺,却因为埋在一个要连库的 async 函数里
 *    一直测不了。现在可以直接对着「差 0.5 分卡 3 所」这种具体情形写断言。
 */
export function planActions({
  choices,
  materials,
  essays,
  profile,
}: {
  choices: PlannerChoice[]
  materials: PlannerMaterial[]
  essays: PlannerEssay[]
  profile: PlannerProfile | null
}): ActionPlan {
  const actions: Action[] = []
  const risks: Risk[] = []

  // ── 还没选校:别的都无从谈起 ──────────────────────────
  if (choices.length === 0) {
    return {
      actions: [
        {
          kind: 'no_schools',
          title: '先把选校单建起来',
          why: '材料清单、文书任务、截止提醒都是按选校单生成的 —— 这一步不做,后面全是空的。',
          href: '/app/schools',
          cta: '去挑学校',
          score: 1000,
        },
      ],
      risks: [],
      nearestDays: null,
    }
  }

  /**
   * ⚠️ 全部经 countdownDeadline 过闸:口径不明 / 只适用本地申请人的日期
   *    一律当作「没有截止日」,于是走下面 effectiveDays 的宽松默认值(120 天),
   *    而不是拿它去催人或判定「本轮已过截止」。见 lib/programs/deadline.ts。
   */
  const withDays = choices.map((c) => ({
    c,
    days: daysUntil(countdownDeadline(c.program.finalDeadline, c.program.deadlineAudience)),
  }))
  const future = withDays.filter((x) => x.days !== null && x.days >= 0)
  const nearestDays = future.length ? Math.min(...future.map((x) => x.days!)) : null

  /**
   * 没有可用截止日时,**排序**按一个较宽松的默认值参与计算,
   * 避免这些项目永远排在最后。
   *
   * ⚠️ 这个数只能进 score,**绝不能进 why / detail 的文案**。
   *    它在库里和官网上都不存在 —— 说出口就是编数字。
   *    2026-08-19 实测踩到:选校单里只有口径不明的截止日时,
   *    页面写「2 所学校都要这一份……最近的截止日还有 120 天」,
   *    而那 2 所的截止日其实是 2 天后、只是档次没核过。
   *    120 既不是真的,也不是保守的,纯属凭空。
   */
  const FALLBACK_DAYS = 120
  const effectiveDays = (d: number | null) => (d === null ? FALLBACK_DAYS : d)

  /** 一组截止日里最近的那个;全都不可用时返回 null —— 不编数字 */
  const nearestOf = (list: Array<number | null>): number | null => {
    const real = list.filter((d): d is number => d !== null)
    return real.length ? Math.min(...real) : null
  }

  /** 「最近的截止日还有 N 天」这句话,只在真有可用截止日时才说得出口 */
  const deadlineClause = (d: number | null) =>
    d === null ? '这几所的截止日我们还没核实档次,请以项目官网为准。' : `最近的截止日还有 ${d} 天。`

  // ── 已过截止:先清理,否则后面的排序全被它带偏 ──────────
  const expired = withDays.filter(
    (x) => x.days !== null && x.days < 0 && !['submitted', 'admitted', 'rejected', 'waitlisted', 'interview_invited'].includes(x.c.status),
  )
  if (expired.length > 0) {
    actions.push({
      kind: 'expired',
      title: `${expired.length} 所学校本轮已过截止`,
      why: `${expired.map((x) => x.c.program.school.nameZh ?? x.c.program.school.nameEn).slice(0, 3).join('、')}${expired.length > 3 ? ' 等' : ''}的截止日已经过了。留在单子里会让进度和提醒都失真 —— 确认放弃就移除,还有下一轮就把状态改掉。`,
      href: '/app/schools',
      cta: '去处理',
      score: 900,
    })
  }

  // ── 语言成绩:周期最长,拖不起 ────────────────────────
  if (profile?.languageType && profile.languageScore != null) {
    const shortfallOf = (c: PlannerChoice) =>
      languageShortfall(
        profile.languageType,
        profile.languageScore,
        profile.languageMinBand,
        readRequirements(c.program),
      )
    const blocked = choices.filter((c) => shortfallOf(c) !== null)
    if (blocked.length > 0) {
      const shortfalls = blocked.map((c) => shortfallOf(c)!).sort((a, b) => a.gap - b.gap)
      const minGap = shortfalls[0].gap
      /**
       * 只要有一所是被单项卡住的,标题就得点出「单项」——
       * 说「差 0.5 分」而不说是哪种分,学生会去刷总分,而总分本来就够了。
       */
      const anyBand = shortfalls.some((s) => s.fromBand)
      const nearReal = nearestOf(
        blocked.map((c) =>
          daysUntil(countdownDeadline(c.program.finalDeadline, c.program.deadlineAudience)),
        ),
      )
      const near = effectiveDays(nearReal)

      actions.push({
        kind: 'language_gap',
        title: anyBand
          ? `语言单项差 ${minGap.toFixed(1)} 分,卡着 ${blocked.length} 所学校`
          : `语言成绩差 ${minGap.toFixed(1)} 分,卡着 ${blocked.length} 所学校`,
        why:
          (anyBand
            ? '你的总分够了,但有学校要求每一个单项都到线,而你的最低单项没到 —— 这种情况只能重考。'
            : '') +
          `重考一次从报名到出分通常要两个月,` +
          (nearReal === null
            ? '而这几所的截止日我们还没核实档次,请以项目官网为准。'
            : `而这几所里最近的截止日还有 ${nearReal} 天。`) +
          '要么现在就约考试,要么把这几所换成分数够的项目。',
        href: '/app/schools',
        cta: '看是哪几所',
        // 周期最长的事必须最早开始,给高权重
        score: 800 - Math.min(near, 200),
      })
    }
  } else if (!profile?.languageType) {
    actions.push({
      kind: 'language_gap',
      title: '还没填语言成绩',
      why: '几乎所有项目都卡语言分。不填的话,系统没法告诉你哪些学校你现在就够得着、哪些还差一口气。',
      href: '/app/settings',
      cta: '去补上',
      score: 700,
    })
  }

  // ── 材料:按「挡住几所学校 × 还剩多少天 × 办理周期」排 ──
  const pendingMaterials = materials.filter((m) => m.status !== 'completed')
  for (const m of pendingMaterials) {
    // 这份材料挡住的学校里,最早的截止日
    const affected = choices.filter((c) => m.programIds.includes(c.programId))
    const realDays = affected.length
      ? nearestOf(
          affected.map((c) =>
            daysUntil(countdownDeadline(c.program.finalDeadline, c.program.deadlineAudience)),
          ),
        )
      : nearestDays
    const days = effectiveDays(realDays)

    const lead = m.template.leadTimeDays
    /** 留给这件事的余量:剩余天数 - 办理周期。负数就是已经来不及了 */
    const slack = days - lead

    actions.push({
      kind: 'material',
      title: `办${m.template.name}`,
      why:
        (affected.length > 1 ? `${affected.length} 所学校都要这一份,办一次就够。` : '') +
        (lead >= 14 ? `通常要 ${lead} 天,` : '') +
        deadlineClause(realDays),
      href: '/app/materials',
      cta: '去处理',
      // 余量越小越急;挡住的学校越多越优先
      score: 600 - slack * 2 + affected.length * 5,
    })

    /**
     * 余量为负 = 按常规周期已经赶不上,这才是「提前预警」的意义。
     *
     * ⚠️ 必须 realDays !== null。「赶不上」是一句斩钉截铁的话,
     *    建立在兜底值上就成了凭空吓人 —— 而且下面的文案要写出具体天数。
     */
    if (slack < 0 && affected.length > 0 && realDays !== null) {
      risks.push({
        level: 'warn',
        title: `${m.template.name}可能赶不上`,
        detail: `${affected[0].program.school.nameZh ?? affected[0].program.school.nameEn}还有 ${realDays} 天截止,而${m.template.name}通常要 ${lead} 天才能办下来。现在就去办还有机会走加急,再等就只能放弃这一所了。`,
      })
    }
  }

  // ── 文书:每所学校一篇,不能复用 ──────────────────────
  // Essay.programId 可空(通用文书),过滤掉再比对
  const essayDone = new Set(
    essays
      .filter((e) => e.status === 'final' && e.programId !== null)
      .map((e) => e.programId as string),
  )
  const needEssay = choices.filter((c) => !essayDone.has(c.programId))
  if (needEssay.length > 0) {
    const realDays = nearestOf(
      needEssay.map((c) =>
        daysUntil(countdownDeadline(c.program.finalDeadline, c.program.deadlineAudience)),
      ),
    )
    const days = effectiveDays(realDays)
    const started = essays.filter((e) => e.status !== 'final').length
    actions.push({
      kind: 'essay',
      title: started > 0 ? `还有 ${needEssay.length} 篇文书没定稿` : `开始写文书(${needEssay.length} 篇)`,
      why:
        '每所学校的题目和字数都不一样,不能直接复用。写好一篇通常要改三四稿,' +
        deadlineClause(realDays),
      href: '/app/essays',
      cta: started > 0 ? '继续写' : '开始写',
      score: 500 - Math.min(days, 200) + needEssay.length * 3,
    })
  }

  // ── 万事俱备,就差递交 ────────────────────────────────
  const ready = withDays.filter(
    (x) =>
      x.c.status === 'ready_to_submit' ||
      (x.days !== null && x.days >= 0 && x.days <= 14 && x.c.status !== 'submitted'),
  )
  if (ready.length > 0) {
    const soonest = ready.reduce((a, b) => (effectiveDays(a.days) < effectiveDays(b.days) ? a : b))
    actions.push({
      kind: 'submit',
      title: '该递交了',
      /**
       * ⚠️ soonest.days 可能是 null —— ready 的第一个条件是
       *    status === 'ready_to_submit',它和截止日无关。
       *    原来直接插值,这种情况下页面上会出现「XX还有 null 天截止」。
       */
      why:
        `${soonest.c.program.school.nameZh ?? soonest.c.program.school.nameEn}` +
        (soonest.days === null ? '的材料齐了,可以递交了。' : `还有 ${soonest.days} 天截止。`) +
        (soonest.c.program.isRolling ? '这所是滚动录取,越早交名额越多。' : ''),
      href: '/app/schools',
      cta: '去确认',
      score: 950 - effectiveDays(soonest.days) * 3,
    })
  }

  // ── 选校结构风险 ──────────────────────────────────────
  const safeCount = choices.filter((c) => c.tierTag === 'safe').length
  if (choices.length >= 3 && safeCount === 0) {
    risks.push({
      level: 'info',
      title: '选校单里没有保底',
      detail: `${choices.length} 所全是冲刺或匹配。保底不是「凑数」,是让你在最坏情况下仍然有学上 —— 建议至少加 1-2 所把握较大的。`,
    })
  }

  // 滚动录取的学校单独提一句 —— 学生普遍不知道「早交」在这里意味着什么
  const rolling = choices.filter(
    (x) => x.program.isRolling && !['submitted', 'admitted', 'rejected'].includes(x.status),
  )
  if (rolling.length > 0) {
    risks.push({
      level: 'info',
      title: `${rolling.length} 所是滚动录取`,
      detail:
        '滚动录取是招满即止,不是等到截止日统一筛。对这些学校,「早交」比「交得完美」更重要 —— 最后一轮通常已经没什么名额了。',
    })
  }

  actions.sort((a, b) => b.score - a.score)

  return {
    // 一次只给 3 条 —— 给多了等于没给
    actions: actions.slice(0, 3),
    risks: risks.slice(0, 3),
    nearestDays,
  }
}
