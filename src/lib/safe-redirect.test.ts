import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeRedirectPath, DEFAULT_AFTER_LOGIN } from '@/lib/safe-redirect'

/**
 * 开放重定向。
 *
 * 登录页从 `?next=` 取跳转目标。不校验的话,攻击者发一个**真实域名**的链接,
 * 用户在真站点上完成登录之后落到仿冒页 ——「会话已过期,请重新登录」——
 * 再输一遍手机号和验证码。验证码登录正是这个产品的主路径,所以代价很实在。
 */

describe('必须挡掉的站外目标', () => {
  it.each([
    ['//evil.com', '协议相对 URL —— 最常见的绕过'],
    ['//evil.com/login', '协议相对 + 路径'],
    ['https://evil.com', '绝对 URL'],
    ['http://evil.com', '绝对 URL(http)'],
    ['//evil.com\\@compass.cn', '用 @ 混淆'],
    ['/\\evil.com', '反斜杠,部分浏览器等价于 //'],
    ['/%2f%2fevil.com', '编码后的双斜杠'],
    ['%2f%2fevil.com', '整个目标都编码了'],
    ['javascript:alert(1)', '伪协议'],
    ['JaVaScRiPt:alert(1)', '大小写混写的伪协议'],
    ['data:text/html,<script>', 'data 协议'],
    ['app/dashboard', '相对路径,不以 / 开头'],
    ['', '空串'],
  ])('%s(%s)', (input) => {
    expect(safeRedirectPath(input)).toBe(DEFAULT_AFTER_LOGIN)
  })

  it('null / undefined 退回默认页', () => {
    expect(safeRedirectPath(null)).toBe(DEFAULT_AFTER_LOGIN)
    expect(safeRedirectPath(undefined)).toBe(DEFAULT_AFTER_LOGIN)
  })

  it('控制字符要挡 —— 换行会被某些解析器忽略', () => {
    expect(safeRedirectPath('/\n//evil.com')).toBe(DEFAULT_AFTER_LOGIN)
    expect(safeRedirectPath('\t//evil.com')).toBe(DEFAULT_AFTER_LOGIN)
  })

  it('坏的百分号编码直接拒绝,不猜', () => {
    expect(safeRedirectPath('/%zz')).toBe(DEFAULT_AFTER_LOGIN)
  })
})

describe('正常的站内路径要放行', () => {
  it.each([
    '/app/dashboard',
    '/app/materials',
    '/app/essay/abc123',
    '/app/schools?region=UK',
    '/app/referees#top',
    '/',
  ])('%s', (input) => {
    expect(safeRedirectPath(input)).toBe(input)
  })

  it('解码后的中文路径也放行', () => {
    expect(safeRedirectPath('/app/%E6%96%87%E4%B9%A6')).toBe('/app/文书')
  })

  it('可以指定别的兜底页', () => {
    expect(safeRedirectPath('//evil.com', '/login')).toBe('/login')
  })
})

describe('登录页真的用上了它', () => {
  const page = readFileSync(join(process.cwd(), 'src/app/login/page.tsx'), 'utf8')

  it('引入并使用了 safeRedirectPath', () => {
    expect(page).toContain('safeRedirectPath')
  })

  it('不存在把 next 直接从 params 拿来就用的写法', () => {
    // 原来是 const next = params.get('next') ?? '/app/dashboard'
    expect(page).not.toMatch(/params\.get\('next'\)\s*\?\?\s*'/)
  })
})
