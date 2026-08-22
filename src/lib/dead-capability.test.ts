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
