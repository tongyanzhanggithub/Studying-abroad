import { describe, it, expect } from 'vitest'
import {
  REFEREE_GROUPS,
  ALL_REFEREE_QUESTION_IDS,
  groupsFor,
  refereeProgress,
  buildRefereePacket,
} from '@/lib/essays/referee-questions'

describe('题库本身', () => {
  it('问题 id 全局唯一', () => {
    const ids = REFEREE_GROUPS.flatMap((g) => g.questions.map((q) => q.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('id 用「分组.问题」的形式', () => {
    for (const g of REFEREE_GROUPS) {
      for (const q of g.questions) expect(q.id.startsWith(`${g.id}.`)).toBe(true)
    }
  })

  it('白名单与题库一致 —— 它是 server action 的入参校验', () => {
    const ids = REFEREE_GROUPS.flatMap((g) => g.questions.map((q) => q.id))
    expect(ALL_REFEREE_QUESTION_IDS.size).toBe(ids.length)
    for (const id of ids) expect(ALL_REFEREE_QUESTION_IDS.has(id)).toBe(true)
  })

  it('两类推荐人都有各自的核心题', () => {
    for (const t of ['academic', 'professional'] as const) {
      const core = groupsFor(t).flatMap((g) => g.questions.filter((q) => q.core))
      expect(core.length).toBeGreaterThan(0)
    }
  })
})

describe('按推荐人类型分组', () => {
  it('学术推荐人看到「课程与成绩」,看不到「工作中的表现」', () => {
    const ids = groupsFor('academic').map((g) => g.id)
    expect(ids).toContain('course')
    expect(ids).not.toContain('work')
  })

  it('职业推荐人反之', () => {
    const ids = groupsFor('professional').map((g) => g.id)
    expect(ids).toContain('work')
    expect(ids).not.toContain('course')
    expect(ids).not.toContain('project')
  })

  it('通用分组两类都有', () => {
    for (const t of ['academic', 'professional'] as const) {
      const ids = groupsFor(t).map((g) => g.id)
      expect(ids).toContain('relation')
      expect(ids).toContain('traits')
    }
  })
})

describe('进度', () => {
  const coreIds = (t: 'academic' | 'professional') =>
    groupsFor(t).flatMap((g) => g.questions.filter((q) => q.core).map((q) => q.id))

  it('全空是 0', () => {
    expect(refereeProgress({}, 'academic').percent).toBe(0)
  })

  it('核心题答完就是 100% —— 选答题不进分母', () => {
    const answers = Object.fromEntries(coreIds('academic').map((id) => [id, 'x']))
    expect(refereeProgress(answers, 'academic').percent).toBe(100)
  })

  it('空白不算已答', () => {
    const answers = Object.fromEntries(coreIds('academic').map((id) => [id, '  \n ']))
    expect(refereeProgress(answers, 'academic').done).toBe(0)
  })

  it('另一类型的题不进分母', () => {
    // 学术推荐人答满,不该因为「工作中的表现」没答而不到 100%
    const answers = Object.fromEntries(coreIds('academic').map((id) => [id, 'x']))
    expect(refereeProgress(answers, 'academic').percent).toBe(100)
    // 反过来同样成立
    const pro = Object.fromEntries(coreIds('professional').map((id) => [id, 'x']))
    expect(refereeProgress(pro, 'professional').percent).toBe(100)
  })
})

describe('素材包 —— 这个模块的立场都在这儿', () => {
  const base = {
    passportName: 'ZHANG San',
    studentName: '张三',
    referee: { name: '李四', title: '副教授', type: 'academic' as const },
    targetPrograms: [{ program: 'MSc Finance', school: 'University of Edinburgh' }],
    deadline: '2027-01-15',
    answers: { 'relation.how': '大二上学期的中国法制史课' },
  }

  /**
   * ⚠️ 最重要的一条。
   *
   *    行业表格的说明是「请以推荐人的口吻回答」—— 产出一封信,老师签字了事。
   *    这个模块产出的必须是**给推荐人的材料**,而且要在正文里说清楚。
   *    这句话被删掉的话,输出就退化成了一封代拟的信。
   */
  it('开头声明评价由推荐人定、且不代拟', () => {
    const text = buildRefereePacket(base)
    expect(text).toContain('完全由您决定')
    expect(text).toContain('不会代拟')
  })

  it('不以推荐人口吻下结论 —— 推荐强度必须是占位,不能预填', () => {
    const text = buildRefereePacket(base)
    for (const banned of ['我推荐', '我很高兴推荐', '兹推荐', 'I am pleased to recommend']) {
      expect(text).not.toContain(banned)
    }
    // 结论那一段必须是让老师自己填的
    expect(text).toContain('用哪一档由您定,我不预设')
  })

  /**
   * ⚠️ 纯文本要贴进邮件,Markdown 星号会原样显示出来。
   *    第一版正文里真的写了 `**…**`。
   */
  it('输出是纯文本,不含 Markdown 标记', () => {
    expect(buildRefereePacket(base)).not.toContain('**')
  })

  // ── 英文相关:推荐信本身是英文的,这几条是这次改动的核心 ──

  /**
   * ⚠️ 原来整份材料是中文的,项目名还用 nameZh。
   *    老师拿到「爱丁堡大学 · 金融学硕士」,得自己去查官方英文名 ——
   *    查错了,信里的项目就和申请对不上。
   */
  it('项目名用官方英文名,不出现中文校名', () => {
    const text = buildRefereePacket(base)
    expect(text).toContain('MSc Finance — University of Edinburgh')
    expect(text).not.toContain('爱丁堡大学')
  })

  /**
   * ⚠️ schema 里 passportSurname 的注释点名列了推荐信:
   *    拼法和成绩单不一致,学校会当成两个人。
   *    这个函数原来传的是中文名。
   */
  it('姓名用护照拼音', () => {
    const text = buildRefereePacket(base)
    expect(text).toContain('ZHANG San')
    expect(text).toContain('as on passport')
  })

  it('没填护照拼音时不硬凑一个,而是说明要补', () => {
    const text = buildRefereePacket({ ...base, passportName: null })
    expect(text).not.toContain('as on passport):  ')
    expect(text).toContain('还没填护照拼音')
  })

  it('给出英文信的结构骨架,五段都在', () => {
    const text = buildRefereePacket(base)
    for (const seg of ['关系与背景', '课堂表现与成绩', '一件具体的事', '与同侪的比较', '推荐结论']) {
      expect(text).toContain(seg)
    }
    expect(text).toContain('To the Admissions Committee,')
  })

  it('职业推荐人的骨架不一样 —— 讲岗位不讲课程', () => {
    const text = buildRefereePacket({
      ...base,
      referee: { ...base.referee, type: 'professional' as const },
    })
    expect(text).toContain('岗位与职责')
    expect(text).not.toContain('课堂表现与成绩')
  })

  it('写明只收英文、要抬头纸和亲笔签名', () => {
    const text = buildRefereePacket(base)
    expect(text).toContain('不接受中文推荐信')
    expect(text).toContain('亲笔签名')
  })

  // ── 原有行为不能回退 ──

  /** ⚠️ ISO 格式 —— 它印在全英文那一块里,中文日期在那儿老师没法照抄 */
  it('截止日用 ISO 格式印在英文区里', () => {
    const text = buildRefereePacket(base)
    expect(text).toContain('Earliest deadline:  2027-01-15')
    expect(text).not.toMatch(/Earliest deadline:.*年/)
  })

  it('只输出答过的题', () => {
    const text = buildRefereePacket(base)
    expect(text).toContain('大二上学期的中国法制史课')
    expect(text).not.toContain('你们平时接触多吗')
  })

  it('没有截止日时不输出空的截止日行', () => {
    expect(buildRefereePacket({ ...base, deadline: null })).not.toContain('Earliest deadline')
  })

  it('没选校时不输出空的项目列表', () => {
    expect(buildRefereePacket({ ...base, targetPrograms: [] })).not.toContain('Programmes applied for')
  })

  it('一条素材都没填时,明说会再发一版,而不是给一份空壳', () => {
    const text = buildRefereePacket({ ...base, answers: {} })
    expect(text).toContain('补齐后会再发您一版')
  })

  it('称呼用职称;没有职称时退回「老师」', () => {
    expect(buildRefereePacket(base)).toContain('李四副教授')
    expect(
      buildRefereePacket({ ...base, referee: { ...base.referee, title: null } }),
    ).toContain('李四老师')
  })
})
