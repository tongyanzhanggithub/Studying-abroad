import { describe, it, expect } from 'vitest'
import { isPrivateIp, htmlToText } from './fetch'

/**
 * SSRF 私网判定。
 *
 * 这是唯一挡住「服务器把云元数据抓回来显示」的闸 —— 阿里云 ECS 上
 * 100.100.100.200 会吐出 RAM 临时凭据,拿到就等于拿到整个云账号的一部分权限。
 *
 * 注释里点名过两种**曾经漏判**的写法(展开形式回环、十六进制映射),
 * 这里必须锁死,否则下次重构很容易改回去。
 */
describe('isPrivateIp —— 必须拒绝', () => {
  it.each([
    // IPv4 私网 / 保留
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    // 云元数据 —— 最要命的两个
    '169.254.169.254', // AWS/通用
    '100.100.100.200', // 阿里云
    '100.64.0.1', // CGNAT 段起点
    '100.127.255.255', // CGNAT 段终点
    // IPv6 回环 / 本地
    '::1',
    '::',
    '0:0:0:0:0:0:0:1', // ⚠️ 展开写法,曾漏判
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::1%eth0', // 带 zone id
    // IPv6 内嵌 IPv4
    '::ffff:7f00:1', // ⚠️ 十六进制映射 127.0.0.1,曾漏判
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '::ffff:100.100.100.200',
    // 畸形输入一律 fail-closed
    '不是IP',
    '',
    '1.2.3',
    '1.2.3.4.5',
  ])('拒绝 %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(true)
  })
})

describe('isPrivateIp —— 必须放行(否则正常院校官网抓不了)', () => {
  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '104.18.32.7',
    '172.15.0.1', // 172 私网段下边界外
    '172.32.0.1', // 172 私网段上边界外
    '100.63.0.1', // CGNAT 段下边界外
    '100.128.0.1', // CGNAT 段上边界外
    '223.255.255.255', // < 224
    '2400:cb00:2048:1::c629:d7a2',
    '2606:4700::6810:2007',
  ])('放行 %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(false)
  })
})

describe('htmlToText', () => {
  it('剔除 script/style —— 内联 JS 里的数字不能被当成事实喂给模型', () => {
    const text = htmlToText(
      '<html><head><style>.a{color:red}</style><script>var x="IELTS 9.0"</script></head>' +
        '<body><h1>MSc Finance</h1><p>IELTS 7.0 &amp; TOEFL 100</p></body></html>',
    )
    expect(text).not.toContain('IELTS 9.0')
    expect(text).not.toContain('color:red')
    expect(text).toContain('MSc Finance')
    expect(text).toContain('IELTS 7.0 & TOEFL 100')
  })

  it('HTML 实体还原', () => {
    expect(htmlToText('<p>a &lt; b &gt; c &quot;d&quot;</p>')).toBe('a < b > c "d"')
  })
})
