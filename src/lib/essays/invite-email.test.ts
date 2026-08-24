import { describe, it, expect } from 'vitest'
import { buildInviteEmail } from '@/lib/essays/referee-questions'

/**
 * 邀请邮件 —— 「问他愿不愿意」那一步。
 *
 * 卡片上原本写着「下一步:先发邮件问对方愿不愿意」,然后给一个
 * 「我已经发邮件问过了」的按钮 —— 系统告诉你该做什么,却把最难的
 * 那一步(措辞)留给你,自己只负责事后打勾。
 */
const base = {
  studentName: '童彦章',
  referee: { name: '张', title: '教授', type: 'academic' as const },
  targetPrograms: ['巴斯大学 · 市场营销理学硕士', '爱丁堡大学商学院 · 金融与投资硕士'],
  deadline: '2027年1月15日',
}

describe('邀请邮件', () => {
  it('把该说的一次说清:申什么、什么时候之前、我会给你什么', () => {
    const t = buildInviteEmail(base)
    expect(t).toContain('巴斯大学 · 市场营销理学硕士')
    expect(t).toContain('2027年1月15日')
    expect(t).toContain('成绩单和简历')
  })

  /**
   * ⚠️ 这一段不能删。
   *    学生最怕被拒,所以往往把话说得没有退路,对方不好意思直说就一直不回 ——
   *    而「等一个不会来的回复」是这一环最常见的翻车方式。
   *    主动给出口,拿到的是更快的答复,不管答案是什么。
   */
  it('给对方一个体面的拒绝出口', () => {
    const t = buildInviteEmail(base)
    expect(t).toContain('不方便')
    expect(t).toContain('我完全理解')
  })

  /**
   * ⚠️ 「你们的交集」只有学生知道,系统不许瞎猜 ——
   *    猜错了比不写更糟(老师会觉得这封信是群发的)。
   */
  it('把「你们的交集」留成占位,不替学生编', () => {
    const t = buildInviteEmail(base)
    expect(t).toContain('[')
    expect(t).toContain('这一句决定他能不能想起你')
  })

  it('学术和职业推荐人,开场白不一样', () => {
    const academic = buildInviteEmail(base)
    const professional = buildInviteEmail({
      ...base,
      referee: { ...base.referee, type: 'professional' as const },
    })
    expect(academic).toContain('上过您的什么课')
    expect(professional).toContain('跟着您的')
    expect(professional).not.toContain('上过您的什么课')
  })

  it('没有截止日时不留一句空话,而是说明会再告知', () => {
    const t = buildInviteEmail({ ...base, deadline: null })
    expect(t).not.toContain('最早的一个截止日期是')
    expect(t).toContain('学校还没公布')
  })

  it('没选校时不输出空的项目列表', () => {
    const t = buildInviteEmail({ ...base, targetPrograms: [] })
    expect(t).not.toContain('目前打算申请的项目是')
  })

  /** 项目太多时截断,别在一封请求信里糊 20 行 */
  it('项目多于 6 个时折叠', () => {
    const many = Array.from({ length: 9 }, (_, i) => `学校${i} · 项目${i}`)
    const t = buildInviteEmail({ ...base, targetPrograms: many })
    expect(t).toContain('等共 9 个项目')
    expect(t).not.toContain('学校7')
  })

  it('称呼用职称;没有职称时退回「老师」', () => {
    expect(buildInviteEmail(base)).toContain('张教授您好')
    expect(
      buildInviteEmail({ ...base, referee: { ...base.referee, title: null } }),
    ).toContain('张老师您好')
  })

  it('是纯文本,不含 Markdown 标记 —— 要贴进邮件的', () => {
    expect(buildInviteEmail(base)).not.toContain('**')
  })
})
