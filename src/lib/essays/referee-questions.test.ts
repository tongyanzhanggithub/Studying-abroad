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
    studentName: '张三',
    referee: { name: '李四', title: '副教授', type: 'academic' as const },
    targetPrograms: ['爱丁堡大学 · 金融学硕士'],
    deadline: '2027年1月15日',
    answers: { 'relation.how': '大二上学期的中国法制史课' },
  }

  /**
   * ⚠️ 最重要的一条。
   *
   *    行业表格的说明是「请以推荐人的口吻回答」—— 产出一封信,老师签字了事。
   *    这个模块产出的必须是**给推荐人的事实清单**,而且要在正文里说清楚。
   *    这句话被删掉的话,输出就退化成了一封代拟的信。
   */
  it('开头声明这是参考材料、且不代拟', () => {
    const text = buildRefereePacket(base)
    expect(text).toContain('供您撰写推荐信时参考')
    expect(text).toContain('不会代拟')
  })

  it('不以推荐人口吻写作 —— 输出里不出现「我推荐」这类代拟措辞', () => {
    const text = buildRefereePacket(base)
    for (const banned of ['我推荐', '我很高兴推荐', '兹推荐', 'I am pleased to recommend']) {
      expect(text).not.toContain(banned)
    }
  })

  it('带上申请项目和最早截止日 —— 推荐人最需要知道的两件事', () => {
    const text = buildRefereePacket(base)
    expect(text).toContain('爱丁堡大学 · 金融学硕士')
    expect(text).toContain('2027年1月15日')
  })

  it('只输出答过的题', () => {
    const text = buildRefereePacket(base)
    expect(text).toContain('大二上学期的中国法制史课')
    // 同组里没答的不该出现
    expect(text).not.toContain('你们平时接触多吗')
  })

  it('没有截止日时不输出空的截止日行', () => {
    const text = buildRefereePacket({ ...base, deadline: null })
    expect(text).not.toContain('最早的截止日期')
  })

  it('没选校时不输出空的项目列表', () => {
    const text = buildRefereePacket({ ...base, targetPrograms: [] })
    expect(text).not.toContain('我申请的项目')
  })

  it('称呼用职称;没有职称时退回「老师」', () => {
    expect(buildRefereePacket(base)).toContain('李四副教授')
    const noTitle = buildRefereePacket({
      ...base,
      referee: { ...base.referee, title: null },
    })
    expect(noTitle).toContain('李四老师')
  })

  it('职业推荐人只输出职业相关分组', () => {
    const text = buildRefereePacket({
      ...base,
      referee: { name: '王五', title: '总监', type: 'professional' },
      answers: { 'work.duty': '负责渠道数据分析', 'course.grade': '88 分' },
    })
    expect(text).toContain('负责渠道数据分析')
    // course 组对职业推荐人不可见,即便库里有答案也不该带出去
    expect(text).not.toContain('88 分')
  })

  it('多行答案保持缩进,不破坏结构', () => {
    const text = buildRefereePacket({
      ...base,
      answers: { 'relation.how': '第一行\n第二行' },
    })
    expect(text).toContain('  第一行\n  第二行')
  })
})
