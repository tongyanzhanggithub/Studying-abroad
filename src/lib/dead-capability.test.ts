import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { codeOnly } from '@/lib/source-scan'

/**
 * 「写好了但没人调用」的能力。
 *
 * ── 为什么专门测这个 ──────────────────────────────────
 *
 * 这个项目栽过一次:Subscription.coreModuleUseCount 全项目只读不写,
 * 于是退款规则里那句「且核心功能使用少于 3 次」**从来没有生效过**,
 * 而定价页、首页 FAQ、用户协议上都白纸黑字写着它。
 * 说的和做的不一致,且没有任何测试发现得了。
 *
 * 2026-08-19 扫了一遍,又找到两个同样形状的:
 *
 *   changeOwnPassword        写好了、没有任何入口 —— 谁都改不了自己的密码,
 *                            而账号创建页的提示写着「让他登录后尽快自己改掉」
 *   createAssessmentVariant  写好了、没有任何入口 —— 而评估页顶部写着
 *                            「换个地区或方向再算一次,就能并排看哪个组合更稳」
 *
 * 两个的处置方向相反,因为「哪一边是对的」不一样:
 *   changeOwnPassword       文案是对的(人本来就该能改密码)→ 补上入口
 *   createAssessmentVariant 文案是错的(这一页刻意不提供换目标)→ 改文案、删实现
 *
 * ⚠️ 这组守卫只盯**已知的、明确许诺过的**那几个,不做全量扫描。
 *    全量扫「导出但没人调用」误报太多(server action、测试专用导出、
 *    未来要用的工具函数),会误报的守卫最后一定被人删掉。
 */

const ROOT = process.cwd()

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(name) && !name.includes('.test.')) out.push(p)
  }
  return out
}

/** 全部非测试源码,已剥注释 —— 注释里提到函数名不算「有人调用」 */
const ALL_CODE = walk(join(ROOT, 'src'))
  .map((p) => codeOnly(readFileSync(p, 'utf8')))
  .join('\n')

/** 除了定义处之外,还有没有别的地方提到它 */
function callSites(name: string): number {
  const total = (ALL_CODE.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length
  const defs = (ALL_CODE.match(new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`, 'g')) ?? [])
    .length
  return total - defs
}

describe('许诺过的能力必须真的接得上', () => {
  /**
   * ⚠️ 别把这条改成「删掉入口」来让它变绿。
   *    账号创建时那段提示原文:「通过安全渠道转交给本人(不要发在群里),
   *    并让他登录后尽快自己改掉。」—— 产品在让用户做一件事,
   *    那件事就得做得到。
   */
  it('changeOwnPassword 有真实调用点', () => {
    expect(callSites('changeOwnPassword')).toBeGreaterThan(0)
  })

  /** 三种进不了 /admin/accounts 的角色也得有地方改 —— 它要 super_admin */
  it('改密码入口覆盖到运营侧和顾问两条路径', () => {
    const adminMe = readFileSync(join(ROOT, 'src/app/admin/me/page.tsx'), 'utf8')
    const advisor = readFileSync(join(ROOT, 'src/app/advisor/page.tsx'), 'utf8')
    /**
     * ⚠️ 必须查 JSX 里真的渲染了(`<ChangePassword`),不能只查名字出现过。
     *    第一版写的是 toContain('ChangePassword') —— 我把顾问页里
     *    <ChangePassword /> 那一行删掉试红,它**照样绿**,
     *    因为文件顶上那句 import 就满足了断言。
     *    一条永远不红的守卫比没有守卫更糟:它让人以为这里被盯着。
     */
    expect(codeOnly(adminMe)).toContain('<ChangePassword')
    expect(codeOnly(advisor)).toContain('<ChangePassword')
    // /admin/me 的门槛不能被抬到 super_admin,否则又回到原点
    expect(codeOnly(adminMe)).toContain("requireAdmin('data_entry')")
  })

  it('/admin/me 挂进了导航,不是只有知道 URL 的人才进得去', () => {
    const layout = codeOnly(readFileSync(join(ROOT, 'src/app/admin/layout.tsx'), 'utf8'))
    expect(layout).toContain("'/admin/me'")
    expect(layout).toMatch(/'\/admin\/me'[^}]*minRole:\s*'data_entry'/)
  })
})

/**
 * 评估页不提供「在本页换地区/方向」。
 *
 * 顶部原来承诺「换个地区或方向再算一次」,而中部把目标做成只读并解释
 * 「换了地区或方向就不是同一件事的对比了」—— 同一页自相矛盾。
 * 2026-08-19 定:文案是错的那一方。真实路径是去 /assess 新做一份,
 * 列表按手机号查,新做的会自动并排列进来。
 */
describe('评估页的文案和它实际提供的能力一致', () => {
  const page = codeOnly(
    readFileSync(join(ROOT, 'src/app/app/assessments/page.tsx'), 'utf8'),
  ).replace(/\s+/g, ' ')

  /**
   * ⚠️ 盯的是「再算一次」这个动词,不是「换个地区」这几个字 ——
   *    页面里正当地提到过地区/方向(展示当前目标、解释为什么只读),
   *    一刀切会误报。错的是暗示**在这一页**能换了重算。
   */
  it('顶部不再承诺「换个地区或方向再算一次」', () => {
    expect(page).not.toMatch(/换个地区或方向再算一次/)
  })

  it('指向的是真实路径:去 /assess 新做一份', () => {
    expect(page).toContain('新做一份评估')
    expect(page).toContain('href="/assess"')
  })

  /** 决定不提供了,就不该再留一个没有 UI 的 server action 挂在那儿 */
  it('createAssessmentVariant 已经删掉,没有悬空的入口', () => {
    const actions = codeOnly(
      readFileSync(join(ROOT, 'src/app/app/assessments/actions.ts'), 'utf8'),
    )
    expect(actions).not.toContain('export async function createAssessmentVariant')
  })
})

/**
 * 选校单的写入逻辑只能有一份。
 *
 * 此前 src/app/app/schools/actions.ts 里有一份完整的死副本(4 个 server action),
 * 前端实际走的是 /api/shortlist。两份的差别很要命:**死副本没有地区闸门**,
 * 而路由那份专门加了,注释写着「否则可以拿一个未开放地区的 programId
 * 直接调这个 API 把它塞进选校单」。
 *
 * 构建产物里确认过那个模块被 tree-shake 掉了,所以当时不是活的洞 ——
 * 但谁把它接回去就会重新开一个。已删除。
 */
describe('选校单写入只有一份实现', () => {
  it('没有 schools/actions.ts 这份死副本', () => {
    const files = walk(join(ROOT, 'src/app/app/schools'))
    expect(files.map((f) => f.replace(/\\/g, '/')).filter((f) => /schools\/actions\.tsx?$/.test(f))).toEqual([])
  })

  it('唯一的写入口带地区闸门', () => {
    const route = codeOnly(readFileSync(join(ROOT, 'src/app/api/shortlist/route.ts'), 'utf8'))
    expect(route).toContain('getPublicRegions')
    // 手动改状态必须打标记,否则会被材料勾选的自动状态机盖掉
    expect(route).toContain('statusManuallySet: true')
  })
})

/**
 * 后台改密码要让**别的设备**立刻失效,而当前这台留着。
 *
 * ── 为什么这半边是必须的 ────────────────────────────
 *
 * 后台会话是 30 天有效的 JWT、服务端不存 session。只改 passwordHash
 * 对已经签发出去的 token 毫无影响 —— 号被盗、改了密码,攻击者手里
 * 那个 token 照样能再用 30 天。而后台 token 的权限比学生端大得多。
 *
 * 学生端(User.sessionVersion)一直有这道校验,后台一直没有。
 *
 * ── 为什么当前设备不能一起踢 ────────────────────────
 *
 * 他刚刚用旧密码验证过身份,没有理由把他也踢掉 —— 那只会让人
 * 每改一次密码就得重登一次。学生端 setMyPassword 就是这么做的:
 * 版本号 +1 之后,用新版本号给当前设备重新签一次。
 *
 * 本地真实验证过(2026-08-19):
 *   设备 A(改密码这台)   还在登录态,角色正常
 *   设备 B(改之前的 token) 和「完全没有 cookie」一模一样,被踢
 *   新签发的 token         正常进后台
 */
describe('后台会话版本号', () => {
  const session = codeOnly(readFileSync(join(ROOT, 'src/lib/auth/session.ts'), 'utf8'))
  const accounts = codeOnly(readFileSync(join(ROOT, 'src/app/admin/accounts/actions.ts'), 'utf8'))
  const login = codeOnly(readFileSync(join(ROOT, 'src/app/admin/login/actions.ts'), 'utf8'))

  it('getAdminSession 比对版本号', () => {
    expect(session.replace(/\s+/g, ' ')).toContain('(payload.sv ?? 0) !== admin.sessionVersion')
  })

  /**
   * ⚠️ `?? 0` 不能省。这个字段上线之前签发的 token 里没有 sv,
   *    而 DB 默认值是 0 —— 少了它,所有存量后台登录会在上线那一刻被一次性踢光。
   */
  it('对旧 token 兜底到 0,不会一上线就把所有人踢下线', () => {
    expect(session).toContain('payload.sv ?? 0')
  })

  it('登录时把当前版本号签进 token', () => {
    expect(login.replace(/\s+/g, ' ')).toContain('sv: fresh.sessionVersion')
  })

  it('改自己的密码:版本号 +1', () => {
    expect(accounts.replace(/\s+/g, ' ')).toMatch(
      /changeOwnPassword[\s\S]*sessionVersion: \{ increment: 1 \}/,
    )
  })

  /** 别把这条改掉来「简化」—— 少了它,人每改一次密码就得重登一次 */
  it('改自己的密码:当前设备用新版本号重新签,不把自己踢掉', () => {
    expect(accounts.replace(/\s+/g, ' ')).toMatch(
      /changeOwnPassword[\s\S]*createAdminSession\([\s\S]*sv: updated\.sessionVersion/,
    )
  })

  /**
   * 超管重置**别人**的密码是相反的意图:那时候就是要把对方踢下线
   * (号可能出问题了 / 人离职了),所以不重新签。
   */
  it('超管重置别人密码:版本号 +1,且不重新签会话', () => {
    /**
     * ⚠️ 只截 resetAccountPassword 这一个函数的正文。
     *    第一版用 indexOf('\n}\n') 找结尾,在剥过注释的文本上切出来只剩一个字符 'e' ——
     *    断言拿一个空串去比,红得毫无信息量,而且它「红」的原因和被测行为无关。
     *    改成切到**下一个 export** 为止,并先断言截出来的长度合理。
     */
    const from = accounts.indexOf('export async function resetAccountPassword')
    expect(from, '找不到 resetAccountPassword').toBeGreaterThan(-1)
    const rest = accounts.slice(from + 'export async function'.length)
    const to = rest.indexOf('export async function')
    const body = to === -1 ? rest : rest.slice(0, to)
    expect(body.length, '截出来的函数体不该是空的').toBeGreaterThan(200)

    expect(body.replace(/\s+/g, ' ')).toContain('sessionVersion: { increment: 1 }')
    expect(body).not.toContain('createAdminSession')
  })
})

/**
 * 对外文案里不许写死地区清单。
 *
 * ── 为什么 ────────────────────────────────────────────
 *
 * 地区是在后台按核对率**逐个开放**的。而「我们覆盖哪些地区」这句话
 * 原来写死在四个地方:首屏 chip、首页 FAQ、评估页地区选择的 hint、
 * actions.ts 的注释 —— 全都说「美国之外」。
 *
 * 2026-08-19 用户开始做美国,这四处同时变成错的。漏改一处就是对外说错话,
 * 而且没有任何机制会发现 —— 这一整轮修的正是这种形状。
 *
 * 改法:首屏那句从**已开放地区**算出来(和旁边那三个数字同源),
 * FAQ 改成指向评估页(那一页是从数据渲染的),不再自己列清单。
 */
describe('对外文案不写死地区清单', () => {
  const FILES = ['src/app/page.tsx', 'src/app/assess/page.tsx', 'src/app/assess/actions.ts']

  it.each(FILES)('%s 里没有写死的「美国之外」', (rel) => {
    // ⚠️ 剥注释 —— 上面那几段说明里正好引用了这句话当反例
    const src = codeOnly(readFileSync(join(ROOT, rel), 'utf8'))
    expect(src).not.toContain('美国之外')
  })

  it('首屏那句地区文案是算出来的,不是常量', () => {
    const src = codeOnly(readFileSync(join(ROOT, 'src/app/page.tsx'), 'utf8'))
    expect(src).toContain('function heroRegionCopy')
    // 必须真的用上,而不是定义了放着
    expect(src).toContain('heroRegionCopy(openRegions)')
    expect(src).toContain('{regionCopy}')
  })

  /**
   * 和旁边那三个数字同源 —— 否则会出现「文案说 3 个地区、数字写 1」。
   *
   * ⚠️ 这条原来断言的是**一整行字面量**:
   *       const openRegions = [...new Set(schools.map((s) => s.region))]
   *    结果给这行加一个降级分支(库断了就当成「不知道」)它就红了 ——
   *    而那个改动恰恰没有破坏它要守的东西。
   *
   *    字面量断言守的是「代码长什么样」,这里要守的是「两个值同源」。
   *    改成断言这件事本身:openRegions 由 schools 的 region 去重得来,
   *    数字和文案都从 openRegions 取。中间怎么加分支都随意。
   */
  it('文案和「N 个国家/地区」那个数字来自同一份 openRegions', () => {
    const src = codeOnly(readFileSync(join(ROOT, 'src/app/page.tsx'), 'utf8')).replace(/\s+/g, ' ')
    expect(src).toMatch(/const openRegions =.*new Set\(schools\.map\(\(s\) => s\.region\)\)/)
    expect(src).toContain('const openRegionCount = openRegions.length')
    expect(src).toContain('heroRegionCopy(openRegions)')
  })

  /**
   * 降级(数据库读不到)时不许报数字。
   * 兜底原来写死 programCount: 566(真实 143)和一个 ¥1,999 的套餐(真实起价 ¥30)——
   * 库一断首页就对外报一套假数据。详见 src/app/page.tsx 里 getMarketingData 的注释。
   */
  it('降级时地区数不能从兜底院校表反推', () => {
    const src = codeOnly(readFileSync(join(ROOT, 'src/app/page.tsx'), 'utf8')).replace(/\s+/g, ' ')
    expect(src).toContain('degraded ? [] :')
  })
})
