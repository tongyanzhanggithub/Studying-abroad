import 'server-only'
import { db } from '@/lib/db'
import { daysUntil } from '@/lib/utils'
import { readRequirements } from '@/lib/programs/types'

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

/** 语言成绩换算不了的情况下,用于判断「差多少」 */
function languageGap(
  userType: string | null,
  userScore: number | null,
  req: ReturnType<typeof readRequirements>,
): number | null {
  if (!userType || userScore == null) return null
  if (userType === 'ielts' && req.ielts?.overall) return req.ielts.overall - userScore
  if (userType === 'toefl' && req.toefl?.overall) return req.toefl.overall - userScore
  return null
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

  const withDays = choices.map((c) => ({ c, days: daysUntil(c.program.finalDeadline) }))
  const future = withDays.filter((x) => x.days !== null && x.days >= 0)
  const nearestDays = future.length ? Math.min(...future.map((x) => x.days!)) : null

  /** 没有截止日的按一个较宽松的默认值参与计算,避免它们永远排最后 */
  const effectiveDays = (d: number | null) => (d === null ? 120 : d)

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
    const blocked = choices.filter((c) => {
      const gap = languageGap(profile.languageType, profile.languageScore, readRequirements(c.program))
      return gap !== null && gap > 0
    })
    if (blocked.length > 0) {
      const gaps = blocked
        .map((c) => languageGap(profile.languageType, profile.languageScore, readRequirements(c.program))!)
        .sort((a, b) => a - b)
      const minGap = gaps[0]
      const near = Math.min(...blocked.map((c) => effectiveDays(daysUntil(c.program.finalDeadline))))

      actions.push({
        kind: 'language_gap',
        title: `语言成绩差 ${minGap.toFixed(1)} 分,卡着 ${blocked.length} 所学校`,
        why: `重考一次从报名到出分通常要两个月,而这几所里最近的截止日还有 ${near} 天。要么现在就约考试,要么把这几所换成分数够的项目。`,
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
    const days = affected.length
      ? Math.min(...affected.map((c) => effectiveDays(daysUntil(c.program.finalDeadline))))
      : effectiveDays(nearestDays)

    const lead = m.template.leadTimeDays
    /** 留给这件事的余量:剩余天数 - 办理周期。负数就是已经来不及了 */
    const slack = days - lead

    actions.push({
      kind: 'material',
      title: `办${m.template.name}`,
      why:
        affected.length > 1
          ? `${affected.length} 所学校都要这一份,办一次就够。${lead >= 14 ? `通常要 ${lead} 天,` : ''}最近的截止日还有 ${days} 天。`
          : `${lead >= 14 ? `通常要 ${lead} 天,` : ''}最近的截止日还有 ${days} 天。`,
      href: '/app/materials',
      cta: '去处理',
      // 余量越小越急;挡住的学校越多越优先
      score: 600 - slack * 2 + affected.length * 5,
    })

    // 余量为负 = 按常规周期已经赶不上,这才是「提前预警」的意义
    if (slack < 0 && affected.length > 0) {
      risks.push({
        level: 'warn',
        title: `${m.template.name}可能赶不上`,
        detail: `${affected[0].program.school.nameZh ?? affected[0].program.school.nameEn}还有 ${days} 天截止,而${m.template.name}通常要 ${lead} 天才能办下来。现在就去办还有机会走加急,再等就只能放弃这一所了。`,
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
    const days = Math.min(...needEssay.map((c) => effectiveDays(daysUntil(c.program.finalDeadline))))
    const started = essays.filter((e) => e.status !== 'final').length
    actions.push({
      kind: 'essay',
      title: started > 0 ? `还有 ${needEssay.length} 篇文书没定稿` : `开始写文书(${needEssay.length} 篇)`,
      why: `每所学校的题目和字数都不一样,不能直接复用。写好一篇通常要改三四稿,最近的截止日还有 ${days} 天。`,
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
      why: `${soonest.c.program.school.nameZh ?? soonest.c.program.school.nameEn}还有 ${soonest.days} 天截止。${
        soonest.c.program.isRolling ? '这所是滚动录取,越早交名额越多。' : ''
      }`,
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
