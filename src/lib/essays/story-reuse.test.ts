import { describe, it, expect } from 'vitest'
import {
  STORY_HINTS,
  NO_STORY_SOURCE,
  storyHintsFor,
  groupsFor,
} from '@/lib/essays/referee-questions'
import { ALL_QUESTION_IDS } from '@/lib/essays/question-bank'

/**
 * 推荐人题复用素材库的答案。
 *
 * ⚠️ 学生在素材库已经答过 12 道核心题,走到推荐人这里又被问 8 道,
 *    内容大量重叠 —— 而这个产品全站都在讲「经历答一次,所有学校通用」。
 *    唯独这一处自己在让人重复填。
 *
 * ⚠️ 做成「提示 + 一键填入」而不是自动填,因为两边颗粒度不一样:
 *    素材库问「整体成绩有没有起伏」,推荐人问「这门课你排第几」。
 *    搬错了,就是让一位教授在信里写一个不准确的数字。
 */
describe('推荐人题 → 素材库题的映射', () => {
  /**
   * ⚠️ 最要命的一条。素材库的 id 改了 / 删了,这张表就会指向一个
   *    永远取不到答案的 id —— 提示区静默变空,没有任何报错,
   *    而没人会想起来回这儿改。
   */
  it('指向的素材库题目都真实存在', () => {
    for (const [refQ, storyIds] of Object.entries(STORY_HINTS)) {
      for (const sid of storyIds) {
        expect(ALL_QUESTION_IDS.has(sid), `${refQ} → ${sid} 在素材库里不存在`).toBe(true)
      }
    }
  })

  it('被映射的推荐人题目也都真实存在', () => {
    const all = new Set(
      (['academic', 'professional'] as const).flatMap((t) =>
        groupsFor(t).flatMap((g) => g.questions.map((q) => q.id)),
      ),
    )
    for (const refQ of Object.keys(STORY_HINTS)) {
      expect(all.has(refQ), `${refQ} 不是推荐人题目`).toBe(true)
    }
  })

  /**
   * relation.* 问的是「你们怎么认识的、平时接触多不多」——
   * 素材库里没有、也不该有这种和某位老师绑定的内容。
   * 硬给它配一条提示,只会让学生把不相干的东西填进去。
   */
  it('推荐人特有的题不给提示', () => {
    expect(storyHintsFor('relation.how')).toHaveLength(0)
    expect(storyHintsFor('relation.frequency')).toHaveLength(0)
  })

  /**
   * ⚠️ 这条**不要求 100% 覆盖**,要求的是「每道题都被表过态」。
   *
   *    要求全覆盖会逼着后来的人给一道本来就没有来源的题硬配一条,
   *    结果是学生把不相干的内容填进推荐信素材里 —— 守卫反过来制造问题。
   *    所以:配了来源,或者写进 NO_STORY_SOURCE 说明为什么没有,都算过。
   *    漏的只有「新增了一道题,两边都没写」这一种情况 —— 那正是要抓的。
   */
  it('每道推荐人题要么配了来源,要么明确声明没有', () => {
    for (const type of ['academic', 'professional'] as const) {
      const ids = groupsFor(type).flatMap((g) => g.questions.map((q) => q.id))
      const undecided = ids.filter(
        (id) => storyHintsFor(id).length === 0 && !NO_STORY_SOURCE.includes(id),
      )
      expect(
        undecided,
        `这些题既没配素材库来源、也没写进 NO_STORY_SOURCE:${undecided.join(', ')}`,
      ).toEqual([])
    }
  })

  it('NO_STORY_SOURCE 里的题确实存在,而且确实没配来源', () => {
    const all = new Set(
      (['academic', 'professional'] as const).flatMap((t) =>
        groupsFor(t).flatMap((g) => g.questions.map((q) => q.id)),
      ),
    )
    for (const id of NO_STORY_SOURCE) {
      expect(all.has(id), `${id} 不是推荐人题目`).toBe(true)
      expect(storyHintsFor(id), `${id} 两边都写了,自相矛盾`).toHaveLength(0)
    }
  })

  it('没配的题返回空数组,不是 undefined —— 调用方直接 .map 不会炸', () => {
    expect(storyHintsFor('nope.not_a_question')).toEqual([])
  })
})
