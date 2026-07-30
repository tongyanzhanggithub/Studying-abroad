import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { codeOnly } from '@/lib/source-scan'

/**
 * 账号注销的两条边界。
 *
 * ── 一、钱的凭据要留下、且必须解绑 ──────────────────
 *
 * 隐私政策白纸黑字写着「支付记录因财税法规要求需保留,但会与你的身份解绑」。
 * 而在这之前 Payment / Subscription / ServiceOrder **全是 onDelete: Cascade**,
 * 也就是说 deleteAccount 里那句「解绑」的 updateMany 刚写完,
 * 下一行 user.delete() 一级联就把它们删了 —— 承诺的「保留但解绑」,
 * 实际执行的是「直接删掉」。
 *
 * 三张表必须**一起**解绑,少一张就残:Payment 有金额和交易号但**没有 subject**,
 * 卖了什么要靠 Subscription.planId 或 ServiceOrder.skuId 才说得清;
 * 而 ServiceOrder 还挂着交付人的分成凭据(settlementMonth / payoutCents),
 * 删掉就等于把一笔要转给真人的钱的依据抹了。
 *
 * ── 二、个人数据要真删,一条都不能剩 ────────────────
 *
 * Lead 尤其容易漏:它的 convertedUserId 是 SetNull,**级联不会删它**,
 * 而里面存着手机号、GPA、语言成绩、目标地区、完整评估结果和提交 IP。
 * 在这之前注销之后这一整行都留在库里 —— 而它和支付记录不同,
 * 没有任何财税留存理由。必须在 deleteAccount 里显式删。
 */

const ROOT = process.cwd()
const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8')
const deleteSrc = codeOnly(
  readFileSync(join(ROOT, 'src/app/app/settings/actions.ts'), 'utf8'),
)

/** 取某个 model 块里 user 关系的 onDelete 策略与 userId 是否可空 */
function userRelation(model: string): { onDelete: string | null; nullable: boolean } {
  const m = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`))
  if (!m) throw new Error(`找不到 model ${model}`)
  const body = m[1]
  const rel = body.match(
    /user\s+User\??\s+@relation\(fields: \[userId\], references: \[id\], onDelete: (\w+)\)/,
  )
  const nullable = /userId\s+String\?\s*@map\("user_id"\)/.test(body)
  return { onDelete: rel?.[1] ?? null, nullable }
}

describe('钱的凭据:解绑而不删除', () => {
  it.each([
    ['Payment', '金额、时间、交易号 —— 会计凭证本体'],
    ['Subscription', '卖的是哪个套餐;Payment 没有 subject 字段,靠它说清'],
    ['ServiceOrder', '卖的哪个服务,以及交付人的分成凭据'],
  ])('%s 是 SetNull 且 userId 可空(%s)', (model) => {
    const r = userRelation(model)
    expect(r.onDelete, `${model} 的 onDelete`).toBe('SetNull')
    expect(r.nullable, `${model} 的 userId 必须可空,否则 SetNull 无处可落`).toBe(true)
  })
})

describe('个人数据:必须真删', () => {
  it.each([
    'Essay',
    'UserMaterial',
    'Referee',
    'StoryAnswer',
    'TimelineEntry',
    'UserSchoolChoice',
  ])('%s 仍然是 Cascade', (model) => {
    expect(userRelation(model).onDelete).toBe('Cascade')
  })

  /**
   * ⚠️ Lead 是唯一一个「级联删不掉、必须手写」的。
   *    按**手机号**删而不是 convertedUserId:同一个号在注册前可能做过好几次
   *    免费评估,那些行的 convertedUserId 是空的,但同样是这个人的个人信息。
   */
  it('deleteAccount 里显式按手机号删 Lead', () => {
    expect(deleteSrc).toMatch(/db\.lead\.deleteMany\(\{\s*where:\s*\{\s*phone:/)
  })

  it('删 Lead 发生在 user.delete 之前', () => {
    const lead = deleteSrc.indexOf('db.lead.deleteMany')
    const user = deleteSrc.indexOf('db.user.delete')
    expect(lead).toBeGreaterThan(-1)
    expect(user).toBeGreaterThan(-1)
    expect(lead).toBeLessThan(user)
  })

  it('先删存储里的材料文件,再删库 —— 否则加密 blob 会变成找不回的孤儿', () => {
    const storage = deleteSrc.indexOf('storage.remove')
    const user = deleteSrc.indexOf('db.user.delete')
    expect(storage).toBeGreaterThan(-1)
    expect(storage).toBeLessThan(user)
  })
})

describe('不再往 refundReason 里塞注销标记', () => {
  /**
   * 原来是 `payment.updateMany({ data: { refundReason: '用户已注销账号' } })`。
   * 两个毛病:当时 Payment 是 Cascade,这行是纯无用功;而且 refundReason
   * 是退款原因,拿它记注销会污染退款报表。
   * 现在 userId 为 null 本身就是标记,不需要往别的字段里写话。
   */
  it('deleteAccount 不写 refundReason', () => {
    expect(deleteSrc).not.toContain('refundReason')
  })
})

describe('隐私政策与实现一致', () => {
  const privacy = readFileSync(join(ROOT, 'src/app/legal/privacy/page.tsx'), 'utf8')

  it('政策里承诺的「保留但解绑」在 schema 上有对应实现', () => {
    expect(privacy).toContain('解绑')
    // 政策这么写了,三张表就必须是 SetNull —— 上面那组用例保证了这一点
    expect(userRelation('Payment').onDelete).toBe('SetNull')
  })
})
