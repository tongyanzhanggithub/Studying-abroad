import { describe, it, expect } from 'vitest'
import { codeOnly, findCodeLine } from '@/lib/source-scan'

/**
 * 剥注释这件事本身得测 —— 全项目十来条源码守卫都建立在它之上。
 * 它漏剥一种注释,那些守卫就会被「解释违规行为的注释」判红,
 * 而人的第一反应是去改守卫,不是去修工具。
 */

/** 拼出来而不是直接写字面量 —— 否则这个测试文件自己就成了下一个受害者 */
const OPEN_JSX = '{' + '/*'
const CLOSE_JSX = '*' + '/}'

describe('codeOnly', () => {
  it('剥掉 // 行注释', () => {
    expect(codeOnly('const a = 1\n// 这里禁止出现 forbidden\nconst b = 2')).toBe(
      'const a = 1\nconst b = 2',
    )
  })

  it('剥掉块注释的每一行', () => {
    const src = ['/**', ' * 反例:forbidden', ' */', 'const a = 1'].join('\n')
    expect(codeOnly(src)).toBe('const a = 1')
  })

  /**
   * ⚠️ 这是第五次踩坑补上的能力。
   *    JSX 注释的续行以中文/表情开头,行首既不是 // 也不是 * ——
   *    老的逐行过滤一行都拦不住,于是守卫被自己的说明文字判红。
   */
  it('剥掉多行 JSX 注释块 —— 续行不以 * 开头也要剥', () => {
    const src = [
      '<div>',
      `  ${OPEN_JSX}`,
      '    ⚠️ 这句原来写的是「换个地区或方向再算一次」',
      '    改掉的原因见下面',
      `  ${CLOSE_JSX}`,
      '  <p>正文</p>',
      '</div>',
    ].join('\n')
    const out = codeOnly(src)
    expect(out).not.toContain('换个地区或方向再算一次')
    expect(out).toContain('<p>正文</p>')
    expect(out).toContain('<div>')
  })

  it('单行 JSX 注释也剥', () => {
    const src = ['<div>', `  ${OPEN_JSX} 反例:forbidden ${CLOSE_JSX}`, '  <p>正文</p>', '</div>'].join('\n')
    expect(codeOnly(src)).not.toContain('forbidden')
    expect(codeOnly(src)).toContain('<p>正文</p>')
  })

  /** 别把注释之后的真代码一起吞了 —— 那会让守卫漏报,比误报更危险 */
  it('注释块结束后的代码原样保留', () => {
    const src = [
      `${OPEN_JSX}`,
      '  说明',
      `${CLOSE_JSX}`,
      'const forbidden = 1',
    ].join('\n')
    expect(codeOnly(src)).toContain('const forbidden = 1')
  })

  /**
   * ⚠️ 行尾注释保留 —— 这是刻意的,文件顶部的说明写着。
   *    要断言的模式如果可能出现在行尾注释里,就不该用文本扫描。
   */
  it('行尾注释保留(已知取舍)', () => {
    expect(codeOnly('const a = 1 // 说明')).toBe('const a = 1 // 说明')
  })

  it('空输入不炸', () => {
    expect(codeOnly('')).toBe('')
  })
})

describe('findCodeLine', () => {
  it('找代码里的那一行,跳过注释里的同名片段', () => {
    const src = ['// forbidden 出现在注释里', 'const x = "forbidden"'].join('\n')
    expect(findCodeLine(src, 'forbidden')).toBe('const x = "forbidden"')
  })

  it('只在注释里出现 → undefined', () => {
    expect(findCodeLine('// forbidden\nconst a = 1', 'forbidden')).toBeUndefined()
  })
})
