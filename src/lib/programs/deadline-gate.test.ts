import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DeadlineAudience } from '@prisma/client'
import { isCountdownable, countdownDeadline, COUNTDOWNABLE_AUDIENCES } from '@/lib/programs/deadline'
import { codeOnly } from '@/lib/source-scan'

/**
 * 截止日「能不能对用户明说」的闸门。
 *
 * ── 这一组测的是什么 ──────────────────────────────────
 *
 * 2026-08 的核查修好了院校库卡片的文案(deadlineText),但同一个日期在
 * 仪表盘、材料中心、行动计划、每日提醒里各自用裸的 daysUntil 直接算 ——
 * 于是院校库对某个项目写「截止日以官网为准」,仪表盘却在同一个项目上
 * 写「12 天后截止」,定时任务还会主动推一条「还有 3 天」给学生。
 *
 * 2026-08-19 线上实测(310 个项目):
 *   unspecified  257 个,其中 67 个有**未来**截止日
 *   overseas      28 个,其中 14 个有未来截止日
 *   all           25 个,其中  6 个有未来截止日
 * 也就是 87 个未来截止日里 67 个(77%)是没核过档次的 —— 四分之三的倒计时
 * 都建立在一个不知道针对谁的日期上。
 *
 * 所以除了测函数本身,最后还有一道**源码守卫**:新加的页面如果又写了
 * 裸的 daysUntil(x.finalDeadline),直接让测试红。函数写对了但某一页忘了用,
 * 就是这个 bug 本身的形状。
 */

const ALL: DeadlineAudience[] = ['overseas', 'home', 'all', 'unspecified']

describe('哪些档次的截止日可以拿来倒计时', () => {
  it('需签证档(overseas)可以 —— 我们的用户全属于这一档', () => {
    expect(isCountdownable('overseas')).toBe(true)
  })

  it('官网不分档(all)可以', () => {
    expect(isCountdownable('all')).toBe(true)
  })

  /**
   * ⚠️ 这两条是整个闸门存在的理由,改红了不要「顺手改断言」——
   *    UCL 的需签证通道 6 月就关了,库里存的是本地档的 8 月日期,
   *    页面照着它显示「还有 13 天」,学生赶完材料发现根本递不进去。
   */
  it('本地档(home)不可以 —— 对需要签证的中国学生根本无效', () => {
    expect(isCountdownable('home')).toBe(false)
  })

  it('口径不明(unspecified)不可以 —— 不知道取的是哪一档', () => {
    expect(isCountdownable('unspecified')).toBe(false)
  })

  it('四个档次都覆盖到了(枚举加了新值这里要跟着想清楚)', () => {
    expect(ALL.filter(isCountdownable).sort()).toEqual(['all', 'overseas'])
  })

  it('给 SQL 用的常量和函数是同一套口径', () => {
    expect([...COUNTDOWNABLE_AUDIENCES].sort()).toEqual(ALL.filter(isCountdownable).sort())
  })
})

describe('countdownDeadline:不可用的日期一律当作没有', () => {
  const d = new Date('2026-12-01T00:00:00+08:00')

  it('可用档次原样返回', () => {
    expect(countdownDeadline(d, 'overseas')).toBe(d)
    expect(countdownDeadline(d, 'all')).toBe(d)
  })

  it('不可用档次返回 null —— 即使日期确实存在', () => {
    expect(countdownDeadline(d, 'home')).toBeNull()
    expect(countdownDeadline(d, 'unspecified')).toBeNull()
  })

  it('本来就没有日期时,任何档次都是 null', () => {
    for (const a of ALL) expect(countdownDeadline(null, a)).toBeNull()
  })

  /** 序列化过的数据里 finalDeadline 可能是字符串,不能因此漏过闸门 */
  it('字符串形式的日期同样受闸门管辖', () => {
    expect(countdownDeadline('2026-12-01', 'overseas')).toBe('2026-12-01')
    expect(countdownDeadline('2026-12-01', 'unspecified')).toBeNull()
  })

  it('undefined 不会被当成有日期', () => {
    expect(countdownDeadline(undefined, 'overseas')).toBeNull()
  })
})

/**
 * ── 源码守卫 ──────────────────────────────────────────
 *
 * 用户侧凡是拿截止日算天数的地方,都必须先过 countdownDeadline。
 *
 * ⚠️ 走 codeOnly() 剥注释:这个文件和被扫的文件里都写着「裸的
 *    daysUntil(c.program.finalDeadline)」当反例,不剥的话扫描会匹配到说明文字。
 *    这个坑本项目已经踩过四次,见 lib/source-scan.ts。
 */
describe('源码守卫:用户侧不许拿裸的 finalDeadline 算天数', () => {
  const ROOT = process.cwd()

  /** 会把天数说给用户听的地方 */
  const USER_FACING = [
    'src/app/app/dashboard/page.tsx',
    'src/app/app/materials/page.tsx',
    'src/app/app/schools/page.tsx',
    'src/lib/planner/engine.ts',
    'src/lib/recommendation/engine.ts',
  ]

  /**
   * 把整个文件压成一行再扫 —— 逐行扫会被多行调用骗过去:
   *     daysLeft={daysUntil(
   *       countdownDeadline(...),
   *     )}
   * 第一行看起来就是「裸的 daysUntil」,其实下一行才是闸门。
   * 我第一版就是这么写的,于是它同时误报了这个和另一个合法用法。
   */
  const flatten = (rel: string) => codeOnly(readFileSync(join(ROOT, rel), 'utf8')).replace(/\s+/g, ' ')

  /** 取 open 处那一对括号里的完整内容(处理嵌套) */
  function argAt(src: string, open: number): string {
    let depth = 0
    for (let i = open; i < src.length; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') {
        depth--
        if (depth === 0) return src.slice(open + 1, i)
      }
    }
    return src.slice(open + 1)
  }

  /**
   * ⚠️ 这一条**只检查「有没有引用闸门」,不检查每一处都用对了**。
   *
   *    我先写了个更聪明的版本:找出每个 daysUntil(...finalDeadline...),
   *    要求实参里出现 countdownDeadline,否则必须紧贴在 deadlineText( 后面。
   *    它对下面这种再正常不过的写法误报:
   *
   *        const rawDays = daysUntil(c.program.finalDeadline)   // 原始天数
   *        const urgency = deadlineUrgency(isCountdownable(a) ? rawDays : null)
   *        ... deadlineText(rawDays, true, a)
   *
   *    原始天数先落一个变量、再分别喂给「着色」和「文案」,是这里最合理的写法。
   *    而且卡片组件收到的 daysLeft 是父组件传下来的,文本扫描根本跨不过组件边界。
   *
   *    与其留一个会误报的守卫(误报的守卫最后一定被人删掉或加豁免),
   *    不如老实只断言一件它真能断言的事:**这个文件知道闸门的存在**。
   *    这挡得住「新加一页,整页忘了闸门」—— 也就是这个 bug 本身的形状;
   *    挡不住「引了但某一处漏用」,那种只能靠 review 和下面的文案守卫。
   */
  it.each(USER_FACING)('%s 引用了截止日闸门', (rel) => {
    const src = flatten(rel)
    const usesDeadline = /finalDeadline/.test(src)
    if (!usesDeadline) return
    expect(
      /countdownDeadline|isCountdownable/.test(src),
      `${rel} 用了 finalDeadline 却没引用 countdownDeadline / isCountdownable —— ` +
        '这一页很可能在拿一个没核过档次的日期对用户做倒计时',
    ).toBe(true)
  })

  /**
   * 倒计时那句话只能有一个出处。
   *
   * ⚠️ 这是本轮最值钱的一条断言:bug 的根因不是哪个函数写错了,而是
   *    同一句「还有 N 天」在 lib、院校库卡片、选校单控件、仪表盘各写了一遍,
   *    档次闸门只加在其中一处。谁再抄一份,这里立刻红。
   *
   * ⚠️ 只扫**渲染截止日标签**的那几个文件。planner/recommendation 里也有
   *    「最近的截止日还有 N 天」,但那是行动理由里的一句散文、数值也已过闸门,
   *    把它们算进来就是误报。
   */
  it('倒计时标签只在 lib/programs/deadline.ts 里拼', () => {
    const RENDERS_LABEL = [
      'src/app/app/dashboard/page.tsx',
      'src/app/app/schools/page.tsx',
      'src/app/app/schools/Controls.tsx',
      'src/app/app/schools/ProgramCard.tsx',
    ]
    const PHRASES = ['天后截止', '还有 ${', '今天截止', '本轮已截止']
    const guilty: string[] = []
    for (const rel of RENDERS_LABEL) {
      const src = flatten(rel)
      for (const ph of PHRASES) if (src.includes(ph)) guilty.push(`${rel} → ${ph}`)
    }
    expect(guilty, `倒计时文案又被复制到别处:${guilty.join(' | ')}`).toEqual([])
  })

  /**
   * 提醒是唯一会**主动推送**的链路 —— 页面写错用户可能看一眼就过去,
   * 推送写错他会照着它熬夜赶材料。所以这里额外要求过滤下推到 SQL。
   */
  it('每日截止提醒在 SQL 里就按档次过滤', () => {
    const code = codeOnly(readFileSync(join(ROOT, 'src/lib/notifications/send.ts'), 'utf8'))
    expect(code).toContain('deadlineAudience')
    expect(code).toContain('COUNTDOWNABLE_AUDIENCES')
  })

  /**
   * 文案只能有一份实现。此前 schools/page.tsx 里有一份和 lib 逐字相同的副本,
   * 改一处、另一处悄悄保持旧行为,正是这类 bug 的温床。
   */
  it('deadlineText 只在 lib 里定义一次', () => {
    const files = [...USER_FACING, 'src/app/admin/programs/page.tsx']
    const defs = files.filter((rel) =>
      /function deadlineText/.test(codeOnly(readFileSync(join(ROOT, rel), 'utf8'))),
    )
    expect(defs, `这些文件里又出现了本地副本:${defs.join(', ')}`).toEqual([])
  })
})
