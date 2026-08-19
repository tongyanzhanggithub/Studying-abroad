import { describe, it, expect } from 'vitest'
import {
  languageGap,
  planActions,
  type PlannerChoice,
  type PlannerEssay,
  type PlannerMaterial,
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
  profile?: { languageType: string | null; languageScore: number | null } | null
} = {}) =>
  planActions({
    choices: over.choices ?? [],
    materials: over.materials ?? [],
    essays: over.essays ?? [],
    profile: over.profile ?? { languageType: 'ielts', languageScore: 7.5 },
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
      profile: { languageType: null, languageScore: null },
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
      profile: { languageType: 'ielts', languageScore: 6.5 },
    })
    const a = p.actions.find((x) => x.kind === 'language_gap')
    expect(a?.title).toContain('0.5')
    expect(a?.title).toContain('2 所')
  })

  it('分数够了就不提语言', () => {
    const p = plan({
      choices: [choice({ program: { requirements: { ielts: { overall: 6.5, subscores: null } } } as never })],
      profile: { languageType: 'ielts', languageScore: 7 },
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
        profile: { languageType: 'ielts', languageScore: 6 },
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
      profile: { languageType: 'ielts', languageScore: 5 },
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
