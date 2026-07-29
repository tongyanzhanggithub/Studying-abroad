import { describe, it, expect } from 'vitest'
import {
  STORY_SECTIONS,
  ALL_QUESTION_IDS,
  visibleSections,
  storyProgress,
  formatAnswersForPrompt,
} from '@/lib/essays/question-bank'

const CTX_FRESH = { hasWorkExperience: false, isMajorSwitch: false }
const CTX_WORKED = { hasWorkExperience: true, isMajorSwitch: false }
const CTX_SWITCH = { hasWorkExperience: false, isMajorSwitch: true }

describe('题库本身', () => {
  it('问题 id 全局唯一 —— 重复会让两道题共用一行答案,互相覆盖', () => {
    const ids = STORY_SECTIONS.flatMap((s) => s.questions.map((q) => q.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('id 用「小节.问题」的形式,便于日后迁移时定位', () => {
    for (const s of STORY_SECTIONS) {
      for (const q of s.questions) {
        expect(q.id.startsWith(`${s.id}.`)).toBe(true)
      }
    }
  })

  it('ALL_QUESTION_IDS 与题库一致 —— 它是 server action 的白名单,漏一个就存不进去', () => {
    const ids = STORY_SECTIONS.flatMap((s) => s.questions.map((q) => q.id))
    expect(ALL_QUESTION_IDS.size).toBe(ids.length)
    for (const id of ids) expect(ALL_QUESTION_IDS.has(id)).toBe(true)
  })

  it('每个小节都有核心题,否则它的进度分母是 0', () => {
    for (const s of STORY_SECTIONS) {
      expect(s.questions.some((q) => q.core)).toBe(true)
    }
  })

  it('每个小节都写了 why —— 不说明理由的问题看起来像在查户口', () => {
    for (const s of STORY_SECTIONS) expect(s.why.length).toBeGreaterThan(10)
  })

  /**
   * 这条是刻意的产品约束,不是风格检查。
   *
   * 参考的那份行业表格里有「父母的工作和职位分别是什么」。那是明确的个人信息,
   * 而它对一篇硕士 PS 的实际价值很低 —— 招生官关心的是申请人的学术准备。
   * 收集个人信息要有必要性,所以题库里只保留「家人对专业选择的影响」这一层。
   */
  it('不打听家人的职业与家庭经济状况', () => {
    const text = JSON.stringify(STORY_SECTIONS)

    /**
     * ⚠️ 只能禁「家人 + 职业/收入」的组合,不能一刀切禁「职位」这类词 ——
     *    工作经历那一节问的是**申请人自己**的职位,那是 CV 的必备内容。
     *    (第一版就是这么误伤的:banned 里放了裸的「职位」,
     *     把 work.history 的提示语「单位、职位、时间段」判成了违规。)
     */
    const family = ['父母', '家长', '监护人']
    const sensitive = ['工作', '职业', '职位', '收入', '单位']
    for (const f of family) {
      for (const s of sensitive) {
        expect(text).not.toContain(`${f}的${s}`)
        expect(text).not.toContain(`${f}${s}`)
      }
    }
    expect(text).not.toContain('家庭经济')
    expect(text).not.toContain('家庭收入')
  })
})

describe('小节按上下文显示', () => {
  it('应届生看不到「工作经历」', () => {
    const ids = visibleSections(CTX_FRESH).map((s) => s.id)
    expect(ids).not.toContain('work')
  })

  it('已毕业的能看到「工作经历」', () => {
    expect(visibleSections(CTX_WORKED).map((s) => s.id)).toContain('work')
  })

  it('非转专业看不到「转专业说明」', () => {
    expect(visibleSections(CTX_FRESH).map((s) => s.id)).not.toContain('switch')
  })

  it('转专业的能看到', () => {
    expect(visibleSections(CTX_SWITCH).map((s) => s.id)).toContain('switch')
  })

  it('无条件小节对谁都显示', () => {
    for (const ctx of [CTX_FRESH, CTX_WORKED, CTX_SWITCH]) {
      const ids = visibleSections(ctx).map((s) => s.id)
      expect(ids).toContain('academic')
      expect(ids).toContain('motivation')
      expect(ids).toContain('personal')
    }
  })
})

describe('进度', () => {
  const coreIds = (ctx: typeof CTX_FRESH) =>
    visibleSections(ctx).flatMap((s) => s.questions.filter((q) => q.core).map((q) => q.id))

  it('全空是 0%', () => {
    expect(storyProgress({}, CTX_FRESH)).toMatchObject({ done: 0, percent: 0 })
  })

  it('核心题全答完是 100%', () => {
    const answers = Object.fromEntries(coreIds(CTX_FRESH).map((id) => [id, '写了点东西']))
    expect(storyProgress(answers, CTX_FRESH).percent).toBe(100)
  })

  /**
   * ⚠️ 这条最重要。选答题如果计入分母,一份认真答完核心题的素材库也到不了 100%,
   *    而一个怎么都填不满的进度条只会让人放弃 —— 材料中心的加分项同理。
   */
  it('选答题不进分母:只答核心题也能到 100%', () => {
    const answers = Object.fromEntries(coreIds(CTX_FRESH).map((id) => [id, 'x']))
    const p = storyProgress(answers, CTX_FRESH)
    expect(p.percent).toBe(100)
    // 确认题库里确实存在选答题,否则这条断言没有意义
    const optional = STORY_SECTIONS.flatMap((s) => s.questions.filter((q) => !q.core))
    expect(optional.length).toBeGreaterThan(0)
  })

  it('只有空白字符不算已答', () => {
    const answers = Object.fromEntries(coreIds(CTX_FRESH).map((id) => [id, '   \n  ']))
    expect(storyProgress(answers, CTX_FRESH).done).toBe(0)
  })

  it('不可见小节的题不进分母 —— 否则应届生永远满不了', () => {
    const fresh = storyProgress({}, CTX_FRESH).total
    const worked = storyProgress({}, CTX_WORKED).total
    expect(worked).toBeGreaterThan(fresh)
  })

  it('答了不可见小节的题也不会让进度超过 100%', () => {
    // 用户先填成已毕业答了工作经历,又改回在读 —— 答案还在库里
    const all = Object.fromEntries(
      STORY_SECTIONS.flatMap((s) => s.questions.map((q) => [q.id, 'x'])),
    )
    expect(storyProgress(all, CTX_FRESH).percent).toBe(100)
  })
})

describe('给模型的素材文本', () => {
  it('没答过时给出明确说明,而不是空串', () => {
    expect(formatAnswersForPrompt({})).toContain('还没有填写')
  })

  /**
   * ⚠️ 只带答过的题。把没答的也列过去,模型会挨个补问一遍,
   *    而访谈的价值在于顺着已有的往下深挖。
   */
  it('只包含答过的题', () => {
    const out = formatAnswersForPrompt({ 'academic.why_major': '当初是调剂进来的' })
    expect(out).toContain('当初是调剂进来的')
    // 同一小节里没答的那些不该出现
    expect(out).not.toContain('哪几门专业课你学得最投入')
  })

  it('空白答案视同没答', () => {
    expect(formatAnswersForPrompt({ 'academic.why_major': '   ' })).toContain('还没有填写')
  })

  it('带上小节标题,让模型知道素材属于哪一块', () => {
    const out = formatAnswersForPrompt({ 'academic.why_major': '答案' })
    expect(out).toContain('学术背景')
  })

  it('忽略题库里不存在的 key —— 老题库的遗留答案不该漏进 prompt', () => {
    const out = formatAnswersForPrompt({ 'legacy.removed_question': '陈年答案' })
    expect(out).not.toContain('陈年答案')
  })
})
