import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { codeOnly } from '@/lib/source-scan'

/**
 * 「导出我的数据」的完整性。
 *
 * ── 防的是什么 ────────────────────────────────────────
 *
 * 注销那条路不会漏:走的是数据库外键级联,加了新模型自动跟着删。
 * **导出没有这种自动机制** —— 全靠写代码的人记得去 exportMyData 里加一条。
 *
 * 而实际情况是:素材库、推荐人、经历时间轴分三次加进来,三次都忘了更新导出。
 * 用户点「导出我的数据」拿到的是残缺副本,而这条路径正是 PIPL 查阅复制权的落地。
 *
 * 所以这里反过来做:从 schema 里找出所有**属于用户的数据模型**,
 * 减去一份显式的排除名单,剩下的必须出现在 exportMyData 里。
 * 新加模型时这条会红 —— 逼人做一次决定:要么导出,要么写进排除名单说明理由。
 */

const ROOT = process.cwd()
const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8')
const exportSrc = readFileSync(join(ROOT, 'src/app/app/settings/actions.ts'), 'utf8')

/**
 * 明确**不**进导出的模型,每条都要有理由。
 * 往这里加东西必须是一个有意识的决定,不是顺手。
 */
const EXCLUDED: Record<string, string> = {
  // 运营/遥测数据,不是用户提供的内容
  AnalyticsEvent: '埋点事件,系统侧遥测',
  RecommendationEvent: '推荐卡曝光点击记录,系统侧遥测',
  AiUsageDaily: '配额计数,系统侧',
  Notification: '站内消息,用户在收件箱里能看到;导出意义不大',
  // 支付相关已经以 serviceOrders / subscriptions 的形式导出
  Payment: '已通过 serviceOrders / subscriptions 覆盖;且含财税留存字段',
  InvoiceRequest: '发票申请,状态在订单页可见',
  // 归属关系是「线索」而非账号数据,且可能早于账号存在
  Lead: '免费评估留资,按手机号关联;评估结果在评估页可查',
}

/** 从 schema 里抓出所有带 userId 且级联删除的模型 —— 即「属于这个用户的数据」 */
function userOwnedModels(): string[] {
  const out: string[] = []
  const re = /model (\w+) \{([\s\S]*?)\n\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(schema))) {
    const [, name, body] = m
    const belongsToUser =
      /user\s+User\s+@relation\(fields:\s*\[userId\]/.test(body) &&
      /onDelete:\s*Cascade/.test(body)
    if (belongsToUser) out.push(name)
  }
  return out
}

describe('用户数据模型都进了导出', () => {
  const models = userOwnedModels()

  it('schema 里确实认出了一批用户数据模型(防止正则失效导致空跑)', () => {
    expect(models.length).toBeGreaterThan(5)
    // 这几个是肯定该被认出来的
    for (const n of ['StoryAnswer', 'Referee', 'TimelineEntry', 'Essay', 'UserMaterial']) {
      expect(models).toContain(n)
    }
  })

  it.each(userOwnedModels().filter((m) => !(m in EXCLUDED)))(
    '%s 出现在 exportMyData 里',
    (model) => {
      // db.storyAnswer.findMany / db.referee.findMany 这样的调用
      const accessor = model[0].toLowerCase() + model.slice(1)
      expect(exportSrc).toContain(`db.${accessor}.`)
    },
  )

  it('排除名单里的每一项都写了理由', () => {
    for (const [model, reason] of Object.entries(EXCLUDED)) {
      expect(reason.length, `${model} 缺理由`).toBeGreaterThan(5)
    }
  })

  it('排除名单里不该有已经在导出的模型 —— 说明名单过期了', () => {
    for (const model of Object.keys(EXCLUDED)) {
      const accessor = model[0].toLowerCase() + model.slice(1)
      // Payment 例外:注销时会 updateMany 解绑,那不算导出
      if (model === 'Payment') continue
      expect(exportSrc).not.toContain(`db.${accessor}.findMany({ where: { userId`)
    }
  })
})

describe('导出不会无上限拉大字段', () => {
  it('文书版本有 take 上限', () => {
    // 自动保存曾经每次停顿存一份全文,无上限拉会把几百份正文塞进 1 GB 的 Node 堆
    //
    // ⚠️ 不能用 /versions:\s*\{[^}]*take/ —— [^}] 跨不过 orderBy: { ... } 里的那个 }。
    //    实际写法是 `versions: { orderBy: { createdAt: 'desc' }, take: 50 }`。
    //
    // ⚠️ 还要跳过注释行 —— 上面那段注释里就写着 `versions: true` 作为反例,
    //    直接 find 会命中注释,断言变成在检查一句说明文字。
    //    这个坑在项目里踩过三次,已收进 lib/source-scan.ts 的 codeOnly。
    const codeLines = codeOnly(exportSrc).split('\n')

    const line = codeLines.find((l) => l.includes('versions:'))
    expect(line, '导出里找不到 versions').toBeTruthy()
    expect(line).toMatch(/take:\s*\d+/)
    expect(codeLines.join('\n')).not.toContain('versions: true')
  })
})
