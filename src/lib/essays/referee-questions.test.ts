import { describe, it, expect } from 'vitest'
import {
  REFEREE_GROUPS,
  ALL_REFEREE_QUESTION_IDS,
  groupsFor,
  refereeProgress,
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
