import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/lib/env'
import { normalize, parseJson } from '@/lib/collect/extract'
import { htmlToText } from '@/lib/collect/fetch'
import { discoverProgramLinks } from '@/lib/collect/discover'

/**
 * AI 采集的防编造自检(仅开发环境)。
 *
 * 验的是这条功能里最要命的一环:**模型给不出原文出处的值必须被丢掉**。
 * 这条规则一旦失效,采集就从「AI 帮你抄」退化成「AI 帮你编」,
 * 而编出来的均分要求和截止日期看上去和真的一模一样,
 * 审核的人也未必看得出来 —— 所以它必须有自动化检查兜着。
 *
 * 不需要真实 LLM key:喂的是构造出来的模型响应。
 *
 * ⚠️ 生产环境直接 404。
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  if (request.headers.get('x-cron-secret') !== env.cronSecret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const checks: Array<{ name: string; pass: boolean; detail?: string }> = []
  const check = (name: string, pass: boolean, detail?: string) =>
    checks.push({ name, pass, detail })

  // ── 1. 没有 evidence 的值一律丢弃 ────────────────────────
  {
    const raw = normalize({
      gpa_requirement: { value: '均分 85 以上', evidence: null },
      tuition: { value: 'GBP 40,000', evidence: '' },
      ielts_overall: { value: 7, evidence: 'IELTS 7.0 overall' },
    })
    check(
      '无 evidence 的字段被丢弃(这是防编造的核心)',
      raw.gpa_requirement.value === null && raw.tuition.value === null,
      `gpa=${JSON.stringify(raw.gpa_requirement.value)} tuition=${JSON.stringify(raw.tuition.value)}`,
    )
    check('有 evidence 的字段保留', raw.ielts_overall.value === 7)
  }

  // ── 2. 假空值被归一成 null ──────────────────────────────
  {
    const raw = normalize({
      gmat_gre: { value: 'not specified', evidence: 'Some text' },
      work_experience: { value: 'N/A', evidence: 'Some text' },
      interview: { value: '未提及', evidence: 'Some text' },
      campus: { value: '   ', evidence: 'Some text' },
    })
    check(
      '"not specified" / "N/A" / "未提及" / 空白 都归一成 null',
      raw.gmat_gre.value === null &&
        raw.work_experience.value === null &&
        raw.interview.value === null &&
        raw.campus.value === null,
    )
  }

  // ── 3. direction 必须落在枚举内 ─────────────────────────
  {
    const bad = normalize({ direction: { value: '金融硕士', evidence: 'MSc Finance' } })
    check(
      '非法 direction 兜底成 other(否则采纳时会写坏数据库)',
      bad.direction.value === 'other',
      String(bad.direction.value),
    )
    const good = normalize({ direction: { value: 'finance', evidence: 'MSc Finance' } })
    check('合法 direction 原样保留', good.direction.value === 'finance')
  }

  // ── 4. 模型返回结构残缺时不能崩 ─────────────────────────
  {
    const empty = normalize({})
    check(
      '空响应也能收敛出完整结构,全为 null',
      empty.school_name_en.value === null && Array.isArray(empty.uncertainties),
    )
    const junk = normalize({ gpa_requirement: 'ä¸²' })
    check('字段是字符串而非对象时不崩', junk.gpa_requirement.value === null)
  }

  // ── 5. uncertainties 透传 ───────────────────────────────
  {
    const raw = normalize({
      uncertainties: ['无法确定截止日属于哪一届', 123, null],
    })
    check(
      'uncertainties 只保留字符串项',
      raw.uncertainties.length === 1 && raw.uncertainties[0].includes('哪一届'),
    )
  }

  // ── 6. JSON 解析容错 ────────────────────────────────────
  {
    const fenced = parseJson('```json\n{"a":1}\n```') as { a: number }
    check('能从 markdown 代码块里取出 JSON', fenced.a === 1)
    const chatty = parseJson('好的,结果如下:\n{"a":2}\n希望有帮助!') as { a: number }
    check('能从前后有废话的输出里取出 JSON', chatty.a === 2)
    let threw = false
    try {
      parseJson('完全没有 JSON')
    } catch {
      threw = true
    }
    check('没有 JSON 时抛错而不是返回空对象', threw)
  }

  // ── 7. HTML 清洗 ────────────────────────────────────────
  {
    const text = htmlToText(
      '<html><head><style>.a{color:red}</style><script>var x="IELTS 9.0"</script></head>' +
        '<body><h1>MSc Finance</h1><p>IELTS 7.0 &amp; TOEFL 100</p></body></html>',
    )
    check(
      'script/style 内容被剔除(否则内联 JS 会挤掉正文,还可能被当成事实)',
      !text.includes('IELTS 9.0') && !text.includes('color:red'),
      text.slice(0, 120),
    )
    check('正文与实体保留', text.includes('MSc Finance') && text.includes('IELTS 7.0 & TOEFL 100'))
  }

  // ── 8. 按学校采集:链接发现 ─────────────────────────────
  {
    const html = `
      <nav><a href="/">Home</a><a href="/news/2026">News</a><a href="/about">About us</a></nav>
      <ul>
        <li><a href="/courses/postgraduate-2026/taught/msc-finance/">MSc Finance</a></li>
        <li><a href="/courses/postgraduate-2026/taught/msc-accounting/">MSc Accounting and Finance</a></li>
        <li><a href="https://www.bath.ac.uk/courses/postgraduate-2026/taught/mba/">MBA</a></li>
        <li><a href="/courses/undergraduate/bsc-economics/">BSc Economics</a></li>
        <li><a href="/research-centres/finance/">Centre for Finance Research</a></li>
        <li><a href="/phd/finance/">PhD Finance</a></li>
        <li><a href="https://evil.example.com/courses/msc-finance/">MSc Finance (mirror)</a></li>
        <li><a href="https://twitter.com/uniofbath">Twitter</a></li>
        <li><a href="/courses/postgraduate-2026/taught/msc-finance/#fees">MSc Finance</a></li>
        <li><a href="mailto:admissions@bath.ac.uk">Email us</a></li>
      </ul>`
    const links = discoverProgramLinks(html, 'https://www.bath.ac.uk/courses/pg/', {
      host: 'www.bath.ac.uk',
    })
    const urls = links.map((l) => l.url)

    check(
      '外域链接被排除(页面内容是不可信输入,不能让它决定服务器抓哪里)',
      !urls.some((u) => u.includes('evil.example.com')) &&
        !urls.some((u) => u.includes('twitter.com')),
      urls.join(' | '),
    )
    check(
      '识别出授课型硕士项目',
      urls.some((u) => u.endsWith('/msc-finance/')) &&
        urls.some((u) => u.endsWith('/msc-accounting/')),
    )
    check('绝对同域链接也收(MBA)', urls.some((u) => u.endsWith('/mba/')))
    check(
      '本科 / 博士 / 研究中心 / 导航 被排除',
      !urls.some((u) => u.includes('undergraduate')) &&
        !urls.some((u) => u.includes('/phd/')) &&
        !urls.some((u) => u.includes('research-centres')) &&
        !urls.some((u) => u.includes('/news/')) &&
        !urls.some((u) => u.includes('/about')),
      urls.join(' | '),
    )
    check('mailto / 锚点不产生条目', !urls.some((u) => u.startsWith('mailto')))
    check(
      '同一 URL 的锚点变体被去重',
      urls.filter((u) => u.replace(/#.*/, '').endsWith('/msc-finance/')).length === 1,
      String(urls.filter((u) => u.includes('msc-finance')).length),
    )
    check(
      '相对链接基于列表页 URL 解析成绝对地址',
      urls.every((u) => u.startsWith('https://www.bath.ac.uk/')),
    )
  }

  const passed = checks.filter((c) => c.pass).length
  return NextResponse.json(
    { ok: passed === checks.length, passed, total: checks.length, checks },
    { status: passed === checks.length ? 200 : 500 },
  )
}
