import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { codeOnly } from '@/lib/source-scan'
import {
  languageGap,
  languageShortfall,
  planActions,
  type PlannerChoice,
  type PlannerEssay,
  type PlannerMaterial,
  type PlannerProfile,
} from './engine'

/** 相对今天偏移 n 天(中午,避开边界抖动) */
function inDays(n: number): Date {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return d
}

let seq = 0
/**
 * ⚠️ 入参不能写成 Partial<PlannerChoice> —— 那只让 program 这个**字段**可选,
 *    一旦传了就必须是完整对象。于是「只想覆盖 deadlineAudience」也得把
 *    isRolling / requirements / school 抄一遍。
 *    (而且 vitest 不做类型检查,这个错只有 tsc 才会报出来。)
 */
type ChoiceOverride = Partial<Omit<PlannerChoice, 'program'>> & {
  program?: Partial<PlannerChoice['program']>
}
function choice(over: ChoiceOverride = {}): PlannerChoice {
  const { program, ...rest } = over
  return {
    programId: 'prog' + ++seq,
    status: 'not_started',
    tierTag: 'match',
    ...rest,
    program: {
      finalDeadline: inDays(120),
      /**
       * 默认取 overseas(需签证档)—— 这批用例测的是「有一个确实能用的截止日时,
       * 排序和文案对不对」,所以默认必须是能倒计时的那一档。
       * 闸门本身由下面「截止日档次闸门」那一组单独测。
       */
      deadlineAudience: 'overseas',
      isRolling: false,
      requirements: {},
      school: { nameZh: '示例大学', nameEn: 'Example University' },
      ...program,
    },
  }
}

function material(over: Partial<PlannerMaterial> = {}): PlannerMaterial {
  return {
    status: 'not_started',
    programIds: [],
    template: { name: '推荐信', leadTimeDays: 42 },
    ...over,
  }
}

const plan = (over: {
  choices?: PlannerChoice[]
  materials?: PlannerMaterial[]
  essays?: PlannerEssay[]
  profile?: PlannerProfile | null
} = {}) =>
  planActions({
    choices: over.choices ?? [],
    materials: over.materials ?? [],
    essays: over.essays ?? [],
    profile: over.profile ?? { languageType: 'ielts', languageScore: 7.5, languageMinBand: null },
  })

const kinds = (p: ReturnType<typeof plan>) => p.actions.map((a) => a.kind)

// ════════════════════════════════════════════════════════
// 语言差值
// ════════════════════════════════════════════════════════

describe('languageGap', () => {
  it('雅思差值 = 要求 − 我的分', () => {
    expect(languageGap('ielts', 6.5, { ielts: { overall: 7, subscores: null } })).toBe(0.5)
  })

  it('超出要求返回负数(表示已达标)', () => {
    expect(languageGap('ielts', 7.5, { ielts: { overall: 7, subscores: null } })).toBe(-0.5)
  })

  it('托福单独比', () => {
    expect(languageGap('toefl', 95, { toefl: { overall: 100, subscores: null } })).toBe(5)
  })

  /** 官网没写要求就是 null,不能当成 0(0 会被判成「刚好达标」) */
  it('官网没写要求 → null', () => {
    expect(languageGap('ielts', 7, {})).toBeNull()
  })

  it('用户没成绩 → null', () => {
    expect(languageGap('ielts', null, { ielts: { overall: 7, subscores: null } })).toBeNull()
    expect(languageGap(null, 7, { ielts: { overall: 7, subscores: null } })).toBeNull()
  })

  /** 用雅思分去比托福要求会得出荒谬差值,类型不匹配时必须 null */
  it('成绩类型与要求类型不匹配 → null', () => {
    expect(languageGap('ielts', 7, { toefl: { overall: 100, subscores: null } })).toBeNull()
  })
})

// ════════════════════════════════════════════════════════
// 空选校单
// ════════════════════════════════════════════════════════

describe('planActions —— 还没选校', () => {
  /** 材料清单、文书任务、截止提醒都是按选校单生成的,这一步不做后面全是空的 */
  it('只给「先建选校单」这一条,不给别的', () => {
    const p = plan({ choices: [] })
    expect(p.actions).toHaveLength(1)
    expect(p.actions[0].kind).toBe('no_schools')
    expect(p.actions[0].href).toBe('/app/schools')
    expect(p.risks).toEqual([])
    expect(p.nearestDays).toBeNull()
  })

  it('即使有材料和文书,没选校时也不推别的事', () => {
    const p = plan({
      choices: [],
      materials: [material()],
      essays: [{ status: 'draft', programId: 'prog1' }],
    })
    expect(kinds(p)).toEqual(['no_schools'])
  })
})

// ════════════════════════════════════════════════════════
// 最近截止日
// ════════════════════════════════════════════════════════

describe('planActions —— nearestDays', () => {
  it('取最近的未来截止日', () => {
    const p = plan({
      choices: [
        choice({ program: { finalDeadline: inDays(60) } as never }),
        choice({ program: { finalDeadline: inDays(20) } as never }),
      ],
    })
    expect(p.nearestDays).toBe(20)
  })

  /** 已过期的不能当成「最近的截止日」—— 否则倒计时会是负数 */
  it('忽略已过期的', () => {
    const p = plan({
      choices: [
        choice({ program: { finalDeadline: inDays(-10) } as never }),
        choice({ program: { finalDeadline: inDays(45) } as never }),
      ],
    })
    expect(p.nearestDays).toBe(45)
  })

  it('全部未公布时为 null', () => {
    const p = plan({ choices: [choice({ program: { finalDeadline: null } as never })] })
    expect(p.nearestDays).toBeNull()
  })
})

// ════════════════════════════════════════════════════════
// 已过截止
// ════════════════════════════════════════════════════════

describe('planActions —— 已过截止的清理', () => {
  it('过期未递交的会被提出来处理', () => {
    const p = plan({
      choices: [choice({ status: 'preparing_materials', program: { finalDeadline: inDays(-5) } as never })],
    })
    expect(kinds(p)).toContain('expired')
    expect(p.actions.find((a) => a.kind === 'expired')?.title).toContain('1 所')
  })

  /**
   * ⚠️ 已递交/已录取/已面试的不算「过期待处理」——
   *    人家已经交上去了,截止日过了是正常的,提醒他去处理只会制造焦虑。
   */
  it.each(['submitted', 'admitted', 'rejected', 'waitlisted', 'interview_invited'])(
    '%s 状态的不算过期待处理',
    (status) => {
      const p = plan({
        choices: [choice({ status, program: { finalDeadline: inDays(-5) } as never })],
      })
      expect(kinds(p)).not.toContain('expired')
    },
  )
})

// ════════════════════════════════════════════════════════
// 语言成绩
// ════════════════════════════════════════════════════════

describe('planActions —— 语言成绩', () => {
  it('没填语言成绩时提示去补', () => {
    const p = plan({
      choices: [choice()],
      profile: { languageType: null, languageScore: null, languageMinBand: null },
    })
    const a = p.actions.find((x) => x.kind === 'language_gap')
    expect(a?.href).toBe('/app/settings')
  })

  it('分数不够时说清差多少、卡了几所', () => {
    const p = plan({
      choices: [
        choice({ program: { requirements: { ielts: { overall: 7, subscores: null } } } as never }),
        choice({ program: { requirements: { ielts: { overall: 7.5, subscores: null } } } as never }),
      ],
      profile: { languageType: 'ielts', languageScore: 6.5, languageMinBand: null },
    })
    const a = p.actions.find((x) => x.kind === 'language_gap')
    expect(a?.title).toContain('0.5')
    expect(a?.title).toContain('2 所')
  })

  it('分数够了就不提语言', () => {
    const p = plan({
      choices: [choice({ program: { requirements: { ielts: { overall: 6.5, subscores: null } } } as never })],
      profile: { languageType: 'ielts', languageScore: 7, languageMinBand: null },
    })
    expect(kinds(p)).not.toContain('language_gap')
  })

  /** 周期最长的事必须最早开始:截止日越近,语言这条排得越前 */
  it('截止日越近,语言这条分数越高', () => {
    const mk = (days: number) =>
      planActions({
        choices: [
          choice({
            program: {
              finalDeadline: inDays(days),
              deadlineAudience: 'overseas',
              isRolling: false,
              requirements: { ielts: { overall: 7, subscores: null } },
              school: { nameZh: '示例大学', nameEn: 'Example University' },
            },
          }),
        ],
        materials: [],
        essays: [],
        profile: { languageType: 'ielts', languageScore: 6, languageMinBand: null },
      }).actions.find((a) => a.kind === 'language_gap')!.score
    expect(mk(30)).toBeGreaterThan(mk(150))
  })
})

// ════════════════════════════════════════════════════════
// 材料
// ════════════════════════════════════════════════════════

describe('planActions —— 材料', () => {
  it('已完成的材料不再出现在待办里', () => {
    const c = choice()
    const p = plan({
      choices: [c],
      materials: [material({ status: 'completed', programIds: [c.programId] })],
    })
    expect(kinds(p)).not.toContain('material')
  })

  /** 「多校共用材料只办一次」是这个产品的核心卖点,文案必须说出来 */
  it('多所学校共用同一份材料时,文案点明「办一次就够」', () => {
    const a = choice()
    const b = choice()
    const p = plan({
      choices: [a, b],
      materials: [material({ programIds: [a.programId, b.programId] })],
    })
    const m = p.actions.find((x) => x.kind === 'material')
    expect(m?.why).toContain('2 所学校都要这一份')
    expect(m?.why).toContain('办一次就够')
  })

  /**
   * ⚠️ 提前预警的意义就在这里:剩余天数 < 办理周期 = 按常规流程已经赶不上。
   *    这条必须在还来得及走加急的时候出现,而不是截止前一天。
   */
  it('剩余天数不足办理周期 → 出风险提示', () => {
    const c = choice({ program: { finalDeadline: inDays(20) } as never })
    const p = plan({
      choices: [c],
      materials: [
        material({ programIds: [c.programId], template: { name: '推荐信', leadTimeDays: 42 } }),
      ],
    })
    const risk = p.risks.find((r) => r.title.includes('推荐信'))
    expect(risk?.level).toBe('warn')
    expect(risk?.detail).toContain('加急')
  })

  it('时间充裕时不出风险提示', () => {
    const c = choice({ program: { finalDeadline: inDays(200) } as never })
    const p = plan({
      choices: [c],
      materials: [material({ programIds: [c.programId] })],
    })
    expect(p.risks.filter((r) => r.level === 'warn')).toHaveLength(0)
  })

  it('余量越小排得越前', () => {
    const near = choice({ program: { finalDeadline: inDays(20) } as never })
    const far = choice({ program: { finalDeadline: inDays(200) } as never })
    const p = plan({
      choices: [near, far],
      materials: [
        material({ programIds: [far.programId], template: { name: '成绩单', leadTimeDays: 7 } }),
        material({ programIds: [near.programId], template: { name: '推荐信', leadTimeDays: 42 } }),
      ],
    })
    const mats = p.actions.filter((a) => a.kind === 'material')
    expect(mats[0].title).toContain('推荐信')
  })
})

// ════════════════════════════════════════════════════════
// 文书
// ════════════════════════════════════════════════════════

describe('planActions —— 文书', () => {
  it('每所学校一篇,定稿了才算完成', () => {
    const a = choice()
    const b = choice()
    const p = plan({
      choices: [a, b],
      essays: [{ status: 'final', programId: a.programId }],
    })
    const e = p.actions.find((x) => x.kind === 'essay')
    expect(e?.title).toContain('1 篇')
  })

  it('全部定稿后不再提文书', () => {
    const a = choice()
    const p = plan({ choices: [a], essays: [{ status: 'final', programId: a.programId }] })
    expect(kinds(p)).not.toContain('essay')
  })

  /** 通用文书(programId 为空)不能顶掉任何一所学校的专属文书 */
  it('通用文书不算某所学校已完成', () => {
    const a = choice()
    const p = plan({ choices: [a], essays: [{ status: 'final', programId: null }] })
    expect(kinds(p)).toContain('essay')
  })

  it('已开工与未开工的文案不同', () => {
    const a = choice()
    const notStarted = plan({ choices: [a] }).actions.find((x) => x.kind === 'essay')
    const started = plan({
      choices: [a],
      essays: [{ status: 'draft', programId: a.programId }],
    }).actions.find((x) => x.kind === 'essay')
    expect(notStarted?.cta).toBe('开始写')
    expect(started?.cta).toBe('继续写')
  })
})

// ════════════════════════════════════════════════════════
// 递交与风险
// ════════════════════════════════════════════════════════

describe('planActions —— 递交', () => {
  it('状态为待递交时提醒递交', () => {
    const p = plan({ choices: [choice({ status: 'ready_to_submit' })] })
    expect(kinds(p)).toContain('submit')
  })

  it('截止日 14 天内且未递交也会提醒', () => {
    const p = plan({ choices: [choice({ program: { finalDeadline: inDays(10) } as never })] })
    expect(kinds(p)).toContain('submit')
  })

  it('已递交的不再提醒', () => {
    const p = plan({
      choices: [choice({ status: 'submitted', program: { finalDeadline: inDays(10) } as never })],
    })
    expect(kinds(p)).not.toContain('submit')
  })

  it('滚动录取的学校会在理由里点明「越早交名额越多」', () => {
    const p = plan({
      choices: [
        choice({
          status: 'ready_to_submit',
          program: { finalDeadline: inDays(10), isRolling: true } as never,
        }),
      ],
    })
    expect(p.actions.find((a) => a.kind === 'submit')?.why).toContain('滚动录取')
  })
})

describe('planActions —— 选校结构风险', () => {
  it('3 所以上且一所保底都没有 → 提示', () => {
    const p = plan({ choices: [choice(), choice(), choice()] })
    expect(p.risks.some((r) => r.title.includes('没有保底'))).toBe(true)
  })

  it('有保底就不提示', () => {
    const p = plan({ choices: [choice(), choice(), choice({ tierTag: 'safe' })] })
    expect(p.risks.some((r) => r.title.includes('没有保底'))).toBe(false)
  })

  /** 只选了 1-2 所时还谈不上「结构」,不制造焦虑 */
  it('不足 3 所时不提保底', () => {
    const p = plan({ choices: [choice(), choice()] })
    expect(p.risks.some((r) => r.title.includes('没有保底'))).toBe(false)
  })

  it('滚动录取单独提示一次', () => {
    const p = plan({ choices: [choice({ program: { isRolling: true } as never })] })
    expect(p.risks.some((r) => r.title.includes('滚动录取'))).toBe(true)
  })

  it('已递交的滚动录取学校不再提示', () => {
    const p = plan({
      choices: [choice({ status: 'submitted', program: { isRolling: true } as never })],
    })
    expect(p.risks.some((r) => r.title.includes('滚动录取'))).toBe(false)
  })
})

// ════════════════════════════════════════════════════════
// 数量上限(焦虑管理,PRD 14)
// ════════════════════════════════════════════════════════

describe('planActions —— 一次最多 3 条', () => {
  /** 给多了等于没给 */
  it('行动与风险都截断到 3 条', () => {
    const cs = Array.from({ length: 6 }, () => choice({ program: { finalDeadline: inDays(15) } as never }))
    const p = plan({
      choices: cs,
      materials: cs.map((c, i) =>
        material({ programIds: [c.programId], template: { name: `材料${i}`, leadTimeDays: 60 } }),
      ),
      profile: { languageType: 'ielts', languageScore: 5, languageMinBand: null },
    })
    expect(p.actions.length).toBeLessThanOrEqual(3)
    expect(p.risks.length).toBeLessThanOrEqual(3)
  })

  it('按 score 从高到低排', () => {
    const cs = Array.from({ length: 5 }, () => choice({ program: { finalDeadline: inDays(15) } as never }))
    const p = plan({
      choices: cs,
      materials: cs.map((c, i) =>
        material({ programIds: [c.programId], template: { name: `材料${i}`, leadTimeDays: 30 } }),
      ),
    })
    const scores = p.actions.map((a) => a.score)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
  })
})

describe('planActions —— 截止日档次闸门', () => {
  /**
   * 行动计划里的天数会变成「最近的截止日还有 N 天」这类催办文案。
   * 只有档次核过、确实适用于我们用户的截止日才配得上这句话。
   *
   * ⚠️ 2026-08-19 线上:87 个未来截止日里 67 个是 unspecified。
   *    不加闸门的话,四分之三的催办都建立在一个不知道针对谁的日期上。
   *    见 lib/programs/deadline.ts 与 docs/数据核查-2026-08.md。
   */

  it('口径不明的截止日不参与 nearestDays', () => {
    const p = planActions({
      choices: [choice({ program: { finalDeadline: inDays(10), deadlineAudience: 'unspecified' } })],
      materials: [],
      essays: [],
      profile: null,
    })
    expect(p.nearestDays).toBeNull()
  })

  it('本地档(home)同样不参与 —— 对需要签证的学生无效', () => {
    const p = planActions({
      choices: [choice({ program: { finalDeadline: inDays(10), deadlineAudience: 'home' } })],
      materials: [],
      essays: [],
      profile: null,
    })
    expect(p.nearestDays).toBeNull()
  })

  it('需签证档正常参与', () => {
    const p = planActions({
      choices: [choice({ program: { finalDeadline: inDays(10), deadlineAudience: 'overseas' } })],
      materials: [],
      essays: [],
      profile: null,
    })
    expect(p.nearestDays).toBe(10)
  })

  /**
   * ⚠️ 这条最要紧:一个口径不明的过期日期,不该让用户看到
   *    「1 所学校本轮已过截止」并被劝去把学校移出选校单 ——
   *    万一那是本地档的日期,需签证通道其实还开着,劝退就是实打实的损失。
   */
  it('口径不明的过期日期不判定「本轮已过截止」', () => {
    const p = planActions({
      choices: [choice({ program: { finalDeadline: inDays(-30), deadlineAudience: 'unspecified' } })],
      materials: [],
      essays: [],
      profile: null,
    })
    expect(p.actions.map((a) => a.kind)).not.toContain('expired')
  })

  it('档次已核的过期日期照旧判定「本轮已过截止」', () => {
    const p = planActions({
      choices: [choice({ program: { finalDeadline: inDays(-30), deadlineAudience: 'overseas' } })],
      materials: [],
      essays: [],
      profile: null,
    })
    expect(p.actions.map((a) => a.kind)).toContain('expired')
  })

  /**
   * 闸门只降低紧迫度,不该让材料这类事**整个消失** ——
   * 「因为日期存疑所以不提醒你办成绩单」是另一种伤害。
   * 走 effectiveDays 的宽松默认值(120 天),仍然出现在列表里,只是不排最前。
   */
  it('闸门拦下日期后,材料仍然会被提醒,只是不再显得紧急', () => {
    const mk = (audience: 'overseas' | 'unspecified') =>
      planActions({
        choices: [choice({ programId: 'p1', program: { finalDeadline: inDays(5), deadlineAudience: audience } })],
        materials: [{ status: 'pending', programIds: ['p1'], template: { name: '成绩单', leadTimeDays: 30 } }],
        essays: [],
        profile: null,
      })
    const gated = mk('unspecified')
    const open = mk('overseas')

    const scoreOf = (p: ReturnType<typeof planActions>) =>
      p.actions.find((a) => a.kind === 'material')?.score
    expect(scoreOf(gated)).toBeDefined()
    expect(scoreOf(open)).toBeDefined()
    // 同一份材料:日期可信时更急(分数更高)
    expect(scoreOf(open)!).toBeGreaterThan(scoreOf(gated)!)
  })
})

describe('planActions —— 兜底值不许出现在文案里', () => {
  /**
   * 排序用的 FALLBACK_DAYS(120)是个内部默认值,库里和官网上都不存在。
   *
   * ⚠️ 这两条是**跑真实页面才发现的**,单元测试原本全绿:
   *    选校单里只有口径不明的截止日时,页面写
   *      「2 所学校都要这一份……最近的截止日还有 120 天」
   *    而那 2 所其实是 2 天后截止、只是档次没核过。
   *    120 既不是真的也不是保守的,纯属凭空 —— 比说错日期更糟,
   *    因为它连个来源都没有。
   */
  /** 两所都有截止日,但档次都不可用 —— 带雅思要求,好让语言那条也能触发 */
  const REQ = { ielts: { overall: 7, subscores: null } }
  const onlyUngated = () => [
    choice({ programId: 'p1', program: { finalDeadline: inDays(2), deadlineAudience: 'unspecified', requirements: REQ } }),
    choice({ programId: 'p2', program: { finalDeadline: inDays(2), deadlineAudience: 'home', requirements: REQ } }),
  ]

  const allText = (p: ReturnType<typeof planActions>) =>
    [...p.actions.map((a) => `${a.title} ${a.why}`), ...p.risks.map((r) => `${r.title} ${r.detail}`)].join('\n')

  it('材料文案不会冒出「还有 120 天」', () => {
    const p = planActions({
      choices: onlyUngated(),
      materials: [{ status: 'pending', programIds: ['p1', 'p2'], template: { name: '成绩单', leadTimeDays: 30 } }],
      essays: [],
      profile: null,
    })
    /**
     * ⚠️ 断言要盯准「凭空的那个数」,不能一刀切 /\d+ 天/ ——
     *    「通常要 30 天」是材料的办理周期,是真实且必要的信息。
     *    我第一版就是这么写的,把正确的文案也判红了。
     */
    expect(allText(p)).not.toContain('120')
    expect(allText(p)).not.toMatch(/最近的截止日还有/)
    expect(allText(p)).toContain('还没核实档次')
  })

  it('文书文案同样不会', () => {
    const p = planActions({
      choices: onlyUngated(),
      materials: [],
      essays: [],
      profile: null,
    })
    const essay = p.actions.find((a) => a.kind === 'essay')
    expect(essay?.why).toContain('还没核实档次')
    expect(essay?.why).not.toContain('120')
  })

  it('语言成绩文案同样不会', () => {
    const p = planActions({
      choices: onlyUngated(),
      materials: [],
      essays: [],
      profile: { languageType: 'ielts', languageScore: 6, languageMinBand: null },
    })
    const lang = p.actions.find((a) => a.kind === 'language_gap')
    expect(lang?.why).toContain('还没核实档次')
    expect(lang?.why).not.toContain('120')
  })

  /**
   * 「赶不上」是一句斩钉截铁的话。没有可用截止日时不能说 ——
   * 办理周期 > 兜底值(120)的材料原来会凭空触发这条预警。
   */
  it('没有可用截止日时不报「赶不上」', () => {
    const p = planActions({
      choices: onlyUngated(),
      materials: [{ status: 'pending', programIds: ['p1'], template: { name: '签证', leadTimeDays: 200 } }],
      essays: [],
      profile: null,
    })
    expect(p.risks.map((r) => r.title)).not.toContain('签证可能赶不上')
  })

  it('有可用截止日时照旧报「赶不上」', () => {
    const p = planActions({
      choices: [choice({ programId: 'p1', program: { finalDeadline: inDays(2), deadlineAudience: 'overseas' } })],
      materials: [{ status: 'pending', programIds: ['p1'], template: { name: '签证', leadTimeDays: 200 } }],
      essays: [],
      profile: null,
    })
    expect(p.risks.map((r) => r.title)).toContain('签证可能赶不上')
  })

  /**
   * ⚠️ 这条和闸门无关,是顺带发现的老 bug:
   *    ready 的第一个条件是 status === 'ready_to_submit',它**和截止日无关**。
   *    一个没有截止日、但材料齐了的项目会走到这里,而 why 直接插值 soonest.days，
   *    于是页面上出现「XX还有 null 天截止」。
   */
  it('材料齐了但没有截止日时,不会渲染出「还有 null 天截止」', () => {
    const p = planActions({
      choices: [
        choice({
          programId: 'p1',
          status: 'ready_to_submit',
          program: { finalDeadline: null, deadlineAudience: 'unspecified' },
        }),
      ],
      materials: [],
      essays: [],
      profile: null,
    })
    const submit = p.actions.find((a) => a.kind === 'submit')
    expect(submit).toBeDefined()
    expect(submit!.why).not.toContain('null')
    expect(submit!.why).toContain('可以递交了')
  })
})

describe('planActions —— 单项不达标', () => {
  /**
   * schema 在 Profile.languageMinBand 上写着:
   *   「只比总分会给出错误的『达标』结论:总分 7.0 但写作 5.5 的学生,
   *     申请『单项不低于 6.0』的项目一定被拒,而我们会告诉他达标 ——
   *     这是直接违背产品承诺的错误。院校库里 61% 的项目写明了单项要求。」
   *
   * 测评引擎(lib/assessment/engine.ts)照做了,而且注释里写明
   * 「这是最需要修的一类错误」。但**行动计划没有** ——
   * languageGap 只比 overall,PlannerProfile 里甚至没有 languageMinBand 这个字段。
   *
   * 于是同一个学生:测评页说他不达标,工作台却一句不提,
   * 不会催他重考,「今天该做的三件事」里没有这件最要紧的事。
   * 和截止日那个 bug 一模一样的形状:规则实现在一处,另一处绕过去了。
   */
  const REQ_WITH_BAND = {
    ielts: { overall: 6.5, subscores: '单项不低于 6.0' },
  }

  it('总分够、单项不够 —— 必须算作卡住', () => {
    const p = planActions({
      choices: [choice({ program: { requirements: REQ_WITH_BAND } })],
      materials: [],
      essays: [],
      // 总分 7.0 过了 6.5,但写作只有 5.5,差单项要求 0.5
      profile: { languageType: 'ielts', languageScore: 7.0, languageMinBand: 5.5 },
    })
    expect(kinds(p)).toContain('language_gap')
  })

  it('文案要说清是**单项**不够,不能让他以为刷总分就行', () => {
    const p = planActions({
      choices: [choice({ program: { requirements: REQ_WITH_BAND } })],
      materials: [],
      essays: [],
      profile: { languageType: 'ielts', languageScore: 7.0, languageMinBand: 5.5 },
    })
    const lang = p.actions.find((a) => a.kind === 'language_gap')
    expect(lang?.title).toContain('单项')
  })

  it('总分和单项都够 —— 不该报', () => {
    const p = planActions({
      choices: [choice({ program: { requirements: REQ_WITH_BAND } })],
      materials: [],
      essays: [],
      profile: { languageType: 'ielts', languageScore: 7.0, languageMinBand: 6.5 },
    })
    expect(kinds(p)).not.toContain('language_gap')
  })

  /** 学生没填单项时不能瞎猜「不达标」—— 只按总分判,和以前一样 */
  it('学生没填单项 → 只按总分判', () => {
    const p = planActions({
      choices: [choice({ program: { requirements: REQ_WITH_BAND } })],
      materials: [],
      essays: [],
      profile: { languageType: 'ielts', languageScore: 7.0, languageMinBand: null },
    })
    expect(kinds(p)).not.toContain('language_gap')
  })

  /** 官网没写单项要求时同样只按总分判 —— 解析不出来就不判,不猜 */
  it('官网没写单项要求 → 只按总分判', () => {
    const p = planActions({
      choices: [choice({ program: { requirements: { ielts: { overall: 6.5, subscores: null } } } })],
      materials: [],
      essays: [],
      profile: { languageType: 'ielts', languageScore: 7.0, languageMinBand: 5.5 },
    })
    expect(kinds(p)).not.toContain('language_gap')
  })
})

describe('languageShortfall —— 总分与单项一起看', () => {
  const withBand = (overall: number, subscores: string | null) => ({
    ielts: { overall, subscores },
  })

  it('只有总分不够', () => {
    expect(languageShortfall('ielts', 6.0, 6.0, withBand(6.5, null))).toEqual({
      gap: 0.5,
      fromBand: false,
    })
  })

  it('只有单项不够 —— 这正是此前漏掉的情形', () => {
    expect(languageShortfall('ielts', 7.0, 5.5, withBand(6.5, '单项不低于 6.0'))).toEqual({
      gap: 0.5,
      fromBand: true,
    })
  })

  /** 两边都不够时报大的那个 —— 只报小的会让学生以为补完就行 */
  it('两边都不够,报缺口大的那个', () => {
    // 总分差 1.0,单项差 0.5
    expect(languageShortfall('ielts', 5.5, 5.5, withBand(6.5, '单项不低于 6.0'))).toEqual({
      gap: 1.0,
      fromBand: false,
    })
    // 总分差 0.5,单项差 1.5
    expect(languageShortfall('ielts', 6.0, 5.0, withBand(6.5, '各项不低于 6.5'))).toEqual({
      gap: 1.5,
      fromBand: true,
    })
  })

  /** 缺口一样大时算单项 —— 单项更难补,文案该往难的说 */
  it('缺口一样大时算作单项', () => {
    const r = languageShortfall('ielts', 6.0, 6.0, withBand(6.5, '单项不低于 6.5'))
    expect(r).toEqual({ gap: 0.5, fromBand: true })
  })

  it('都达标 → null', () => {
    expect(languageShortfall('ielts', 7.0, 6.5, withBand(6.5, '单项不低于 6.0'))).toBeNull()
  })

  it('学生没填单项 → 退回只比总分', () => {
    expect(languageShortfall('ielts', 7.0, null, withBand(6.5, '单项不低于 6.0'))).toBeNull()
  })

  it('官网没写单项要求 → 退回只比总分', () => {
    expect(languageShortfall('ielts', 7.0, 4.0, withBand(6.5, null))).toBeNull()
  })

  /** 解析不出来的写法不能当成 0 分门槛,否则人人「达标」或人人「不达标」 */
  it('单项写「未列明」→ 不判', () => {
    expect(languageShortfall('ielts', 7.0, 4.0, withBand(6.5, '未列明'))).toBeNull()
  })

  /**
   * ⚠️ 托福不判单项,和测评引擎保持一致 ——
   *    托福单项要求写法差异太大,硬套会解析出错误门槛,那比不判更糟。
   */
  it('托福不判单项', () => {
    expect(
      languageShortfall('toefl', 100, 15, { toefl: { overall: 100, subscores: '每项不低于 22' } }),
    ).toBeNull()
  })
})

describe('源码守卫:判「语言达标」的地方必须看单项', () => {
  /**
   * 这个 bug 的根因不是某个函数写错了,是**同一条规则只实现在一个引擎里**。
   * 测评引擎判单项、行动计划不判,于是同一个学生在两个页面得到相反结论。
   *
   * 解析器现在住在 lib/programs/types.ts,两边都从那里引。
   * 谁再在别处自己拿 overall 判达标,这条就该被扩充 ——
   * 但至少能挡住「解析器被搬回某一个引擎里私有化」这种回退。
   */
  it('测评引擎和行动计划用的是同一个解析器', () => {
    const ROOT = process.cwd()
    const src = (rel: string) => codeOnly(readFileSync(join(ROOT, rel), 'utf8'))

    // 解析器的唯一实现在 types.ts
    expect(src('src/lib/programs/types.ts')).toContain('export function parseMinBandRequirement')

    // 两个引擎都引它,而不是各写一份
    for (const rel of ['src/lib/assessment/engine.ts', 'src/lib/planner/engine.ts']) {
      expect(src(rel), `${rel} 没有引用 parseMinBandRequirement`).toContain(
        'parseMinBandRequirement',
      )
      expect(
        src(rel).includes('export function parseMinBandRequirement'),
        `${rel} 又自己实现了一份解析器 —— 两份一定会漂移`,
      ).toBe(false)
    }
  })
})
