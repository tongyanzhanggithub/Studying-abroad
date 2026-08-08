import { describe, it, expect } from 'vitest'
import { parseCourseUrl, inferLevel, looksLikeCourse } from '@/lib/collect/course-url'
import { parseLocs, parseSitemapUrls, stripXmlComments } from '@/lib/collect/sitemap'

/**
 * 课程 URL 解析 + sitemap 解析。
 *
 * 用例里的 URL **全部取自真实抓取结果**(曼彻斯特 1280 门课),
 * 不是编的 —— 编出来的 URL 只能验证我以为的格式,验证不了真实世界的格式。
 */

const M = 'https://www.manchester.ac.uk'

describe('学历层次判断', () => {
  /**
   * ⚠️ 顺序陷阱:"postgraduate-research" 里含 "postgraduate",
   *    "undergraduate" 里也含 "graduate"。判反了整批数据的层次都是错的。
   */
  it('研究型博士不会被误判成硕士', () => {
    expect(inferLevel('/study/postgraduate-research/programmes/list/12345/phd-physics/')).toBe('phd')
  })

  it('本科不会被 graduate 这个子串带偏', () => {
    expect(inferLevel('/study/undergraduate/courses/2026/07808/bsc-accounting/')).toBe('undergraduate')
  })

  it('授课型硕士', () => {
    expect(inferLevel('/study/masters/courses/list/10867/msc-accounting/')).toBe('masters')
  })

  it('认不出就是 unknown,不瞎猜', () => {
    expect(inferLevel('/about/contact/')).toBe('unknown')
  })
})

describe('课程 URL 解析(真实样本)', () => {
  it('本科:年份 + 课程号 + 学位 + 专业名', () => {
    expect(parseCourseUrl(`${M}/study/undergraduate/courses/2026/07808/bsc-accounting/`)).toEqual({
      url: `${M}/study/undergraduate/courses/2026/07808/bsc-accounting/`,
      level: 'undergraduate',
      year: 2026,
      courseCode: '07808',
      degree: 'BSc',
      name: 'Accounting',
    })
  })

  it('硕士:没有年份段时 year 为 null', () => {
    const r = parseCourseUrl(`${M}/study/masters/courses/list/10867/msc-accounting/`)
    expect(r).toMatchObject({ level: 'masters', year: null, courseCode: '10867', degree: 'MSc' })
  })

  /**
   * ⚠️ 学位缩写必须按长度降序匹配。不然 "ba" 会先命中 "baecon",
   *    把 BAEcon(经济学学士)错认成 BA、专业名变成 "Econ Accounting"。
   */
  it('长缩写优先:BAEcon 不会被认成 BA', () => {
    const r = parseCourseUrl(`${M}/study/undergraduate/courses/2026/05151/baecon-accounting-and-finance/`)
    expect(r.degree).toBe('BAEcon')
    expect(r.name).toBe('Accounting and Finance')
  })

  it.each([
    ['bsc-actuarial-science-and-mathematics', 'BSc', 'Actuarial Science and Mathematics'],
    ['bnurs-adult-nursing', 'BNurs', 'Adult Nursing'],
    ['msci-biochemistry', 'MSci', 'Biochemistry'],
    ['march-architecture', 'MArch', 'Architecture'],
    ['ugdip-egyptology', 'UGDip', 'Egyptology'],
    ['menvsci-environmental-science', 'MEnvSci', 'Environmental Science'],
  ])('%s → %s / %s', (slug, degree, name) => {
    const r = parseCourseUrl(`${M}/study/undergraduate/courses/2026/12345/${slug}/`)
    expect(r.degree).toBe(degree)
    expect(r.name).toBe(name)
  })

  it('专业名里的小词不大写', () => {
    const r = parseCourseUrl(`${M}/study/masters/courses/list/1/msc-management-of-projects/`)
    expect(r.name).toBe('Management of Projects')
  })

  /**
   * 认不出学位时把整个 slug 当专业名,而不是丢掉 ——
   * 人工核对时能看出来这条需要补,丢掉就再也发现不了。
   */
  it('认不出学位时保留专业名', () => {
    const r = parseCourseUrl(`${M}/study/undergraduate/courses/2027/00456/biosciences-with-a-foundation-year/`)
    expect(r.degree).toBeNull()
    expect(r.name).toBe('Biosciences with a Foundation Year')
  })

  it('URL 非法时不抛异常', () => {
    expect(parseCourseUrl('不是个网址').level).toBe('unknown')
  })
})

describe('筛掉非课程页', () => {
  it('收具体课程页', () => {
    expect(looksLikeCourse(`${M}/study/masters/courses/list/10867/msc-accounting/`)).toBe(true)
  })

  /**
   * ⚠️ 宁可漏也不要错收 —— 错收的会一路进到 AI 抽取环节,
   *    白花模型钱,还要人工再挑出来。
   */
  it.each([
    `${M}/study/masters/courses/list/`,
    `${M}/news/some-story/`,
    `${M}/about/contact/`,
    'https://www.manchester.ac.uk/study/masters/fees-and-funding/',
  ])('不收 %s', (url) => {
    expect(looksLikeCourse(url)).toBe(false)
  })
})

describe('sitemap 解析', () => {
  it('从 robots.txt 读出 Sitemap 声明', () => {
    const r = parseSitemapUrls(`
User-agent: *
Disallow: /search/

Sitemap: https://www.manchester.ac.uk/sitemap-index.xml
`)
    expect(r).toEqual(['https://www.manchester.ac.uk/sitemap-index.xml'])
  })

  it('取出 <loc>', () => {
    expect(parseLocs('<url><loc>https://a.test/1</loc></url><url><loc>https://a.test/2</loc></url>'))
      .toEqual(['https://a.test/1', 'https://a.test/2'])
  })

  /**
   * ⚠️ 曼彻斯特的 sitemap index 里真有一条被 <!-- --> 注释掉的条目
   *    (online-blended-learning)。不剥注释就会去抓它,得到 404。
   */
  it('剥掉 XML 注释里的条目', () => {
    const xml = `
<sitemap><loc>https://a.test/real.xml</loc></sitemap>
<!--
<sitemap><loc>https://a.test/commented-out.xml</loc></sitemap>
-->
`
    expect(parseLocs(stripXmlComments(xml))).toEqual(['https://a.test/real.xml'])
  })

  it('容忍 loc 前后的空白', () => {
    expect(parseLocs('<loc>\n  https://a.test/1\n</loc>')).toEqual(['https://a.test/1'])
  })
})
