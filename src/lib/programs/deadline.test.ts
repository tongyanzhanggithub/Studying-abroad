import { describe, it, expect } from 'vitest'
import { deadlineText } from './deadline'

describe('deadlineText —— 没有日期时', () => {
  it('没有截止日 → 待公布', () => {
    expect(deadlineText(null, false, 'overseas')).toBe('截止日待公布')
    expect(deadlineText(30, false, 'overseas')).toBe('截止日待公布')
    expect(deadlineText(null, true, 'overseas')).toBe('截止日待公布')
  })
})

describe('deadlineText —— overseas / all:给倒计时', () => {
  it.each(['overseas', 'all'] as const)('%s 档正常倒计时', (audience) => {
    expect(deadlineText(30, true, audience)).toBe('还有 30 天截止')
    expect(deadlineText(1, true, audience)).toBe('还有 1 天截止')
    expect(deadlineText(0, true, audience)).toBe('今天截止')
    expect(deadlineText(-1, true, audience)).toBe('本轮已截止')
  })
})

describe('deadlineText —— home:对我们的用户无效', () => {
  /**
   * ⚠️ 这是这道闸存在的全部理由。
   *
   *    UCL 官网写「不需要签证的申请人 2026-08-28 截止」,而需签证申请人
   *    早在 2026-06-26 就截止了。库里存了 08-28,页面显示「还有 13 天截止」——
   *    中国学生全部需要签证,那个通道其实已经关闭两个月。
   *    照着这个倒计时去赶材料、交申请费的学生会被直接拒收。
   */
  it('哪怕日期还没到,也绝不给倒计时', () => {
    expect(deadlineText(13, true, 'home')).toBe('本档次不适用,以官网为准')
    expect(deadlineText(200, true, 'home')).toBe('本档次不适用,以官网为准')
  })

  it('已过期同样不说「本轮已截止」—— 它本来就不是这批人的档', () => {
    expect(deadlineText(-5, true, 'home')).toBe('本档次不适用,以官网为准')
  })

  it('文案里不出现任何天数', () => {
    expect(deadlineText(13, true, 'home')).not.toMatch(/\d/)
  })
})

describe('deadlineText —— unspecified:存量数据,口径不明', () => {
  /**
   * 库里 310 个项目都是在加 deadlineAudience 之前采的,默认全是 unspecified。
   * 不知道当初取的是哪一档,就不能拿它做倒计时 —— 那正是出事的方式。
   */
  it('未来的日期不给倒计时,只提示以官网为准', () => {
    expect(deadlineText(30, true, 'unspecified')).toBe('截止日以官网为准')
    expect(deadlineText(0, true, 'unspecified')).toBe('截止日以官网为准')
  })

  it('已过期的标出来但注明口径待核', () => {
    expect(deadlineText(-5, true, 'unspecified')).toBe('本轮已截止(口径待核)')
  })

  it('未来日期的文案里不出现天数', () => {
    expect(deadlineText(30, true, 'unspecified')).not.toMatch(/\d/)
  })
})

describe('deadlineText —— 只有确证适用时才敢说倒计时', () => {
  /** 一句话概括这道闸:含天数的倒计时只能出现在 overseas / all 上 */
  it.each([
    ['overseas', true],
    ['all', true],
    ['home', false],
    ['unspecified', false],
  ] as const)('%s 档出现倒计时?%s', (audience, shouldCountdown) => {
    const text = deadlineText(30, true, audience)
    expect(/还有 30 天/.test(text)).toBe(shouldCountdown)
  })
})
