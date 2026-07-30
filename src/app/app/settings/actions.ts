'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { getStorage } from '@/lib/storage'
import { requireUser, destroySession } from '@/lib/auth/session'
import type { LanguageType, UndergradTier } from '@prisma/client'

export async function updateProfile(input: {
  undergradTier: UndergradTier | null
  /** 本科学科门类 —— 决定方向推荐里哪些是「顺延」哪些是「转向」 */
  undergradMajor: string | null
  gpa: number | null
  gpaScale: string
  languageType: LanguageType | null
  languageScore: number | null
  /** 最低单项(雅思小分)—— 总分够但单项不够会被拒,必须单独记 */
  languageMinBand: number | null
  isMajorSwitch: boolean
}) {
  const user = await requireUser()
  await db.profile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...input },
    update: input,
  })
  revalidatePath('/app/settings')
  return { ok: true as const }
}

/**
 * 数据导出(PRD 10.3)。
 * 返回该用户全部业务数据的 JSON —— 包含材料、文书全部版本、选校单、订单。
 */
export async function exportMyData() {
  const user = await requireUser()

  const [
    profile,
    choices,
    materials,
    essays,
    orders,
    subscriptions,
    storyAnswers,
    referees,
    timeline,
  ] = await Promise.all([
    db.profile.findUnique({ where: { userId: user.id } }),
    db.userSchoolChoice.findMany({
      where: { userId: user.id },
      include: { program: { include: { school: true } } },
    }),
    db.userMaterial.findMany({ where: { userId: user.id }, include: { template: true } }),
    /**
     * ⚠️ 版本必须封顶。
     *
     *    这个 action 的返回值会被整个序列化传回浏览器。以前自动保存是每次停顿
     *    存一份全文,一篇改得多的文书能攒出几百行 —— `versions: true` 无上限拉,
     *    等于把几百份全文一次性读进内存再序列化,而生产的 Node 堆上限是 1 GB
     *    (compass.service 里的 --max-old-space-size=1024)。
     *
     *    自动保存已经改成原地更新(见 essays/actions.ts),新数据不会再这么涨;
     *    但**存量数据里那几百行还在**,而且这里本来也不该无上限。
     *    取最近 50 版:导出的意义是拿走自己的东西,不是拿走每一次击键的快照。
     */
    db.essay.findMany({
      where: { userId: user.id },
      include: {
        versions: { orderBy: { createdAt: 'desc' }, take: 50 },
        aiSessions: true,
      },
    }),
    db.serviceOrder.findMany({ where: { userId: user.id }, include: { sku: true } }),
    db.subscription.findMany({ where: { userId: user.id }, include: { plan: true } }),
    /**
     * ⚠️ 每新增一个存用户数据的模型,这里都必须跟着加一条。
     *
     *    素材库、推荐人、经历时间轴是分三次加进来的,而这三次**一次都没有
     *    更新导出** —— 也就是说用户点「导出我的数据」拿到的是一份残缺的副本,
     *    而这条路径正是 PIPL 查阅复制权的落地。
     *    (注销那边不会漏,因为走的是数据库级联;导出没有这种自动机制,
     *     只能靠写代码的人记得 —— 所以 settings.test.ts 里加了一条断言盯着。)
     */
    db.storyAnswer.findMany({
      where: { userId: user.id },
      select: { questionId: true, answer: true, updatedAt: true },
    }),
    db.referee.findMany({
      where: { userId: user.id },
      include: { answers: { select: { questionId: true, answer: true } } },
    }),
    db.timelineEntry.findMany({ where: { userId: user.id }, orderBy: { startYm: 'asc' } }),
  ])

  return {
    ok: true as const,
    data: {
      exportedAt: new Date().toISOString(),
      account: {
        phone: user.phone,
        name: user.name,
        createdAt: user.createdAt,
        agreedTermsAt: user.agreedTermsAt,
      },
      profile,
      schoolChoices: choices,
      materials,
      essays,
      serviceOrders: orders,
      subscriptions,
      storyAnswers,
      referees,
      timeline,
    },
  }
}

/**
 * 账号注销。
 *
 * ⚠️ 这是不可逆操作,会级联删除该用户的全部业务数据。
 *    支付与订单记录因财税留存义务需保留,但会与用户身份解绑。
 */
export async function deleteAccount(confirmPhone: string) {
  const user = await requireUser()
  if (confirmPhone !== user.phone) {
    return { ok: false as const, error: '手机号输入不正确,未执行注销' }
  }

  const active = await db.subscription.findFirst({
    where: {
      userId: user.id,
      status: 'active',
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  })
  if (active) {
    return {
      ok: false as const,
      error: '你还有生效中的季票。注销将放弃剩余权益且不予退款 —— 如需退款请先到「订单」页申请。',
    }
  }

  /**
   * ⚠️ 先删存储里的材料文件,再删 DB。
   *    只 db.user.delete() 靠外键级联删掉 UserMaterial 行,但护照/身份证/学位证的
   *    加密 blob 会永久留在磁盘/OSS 桶里,而 DB 里已无任何指针能再找到它们 ——
   *    这是 PIPL「删除权」的实打实违规(用户注销了,敏感个人信息仍在),也是存储泄漏。
   *    删文件容错:单个失败只记日志,不阻断注销(DB 行删掉后,残留文件可由离线 GC 兜底)。
   */
  const materials = await db.userMaterial.findMany({
    where: { userId: user.id, fileUrl: { not: null } },
    select: { fileUrl: true },
  })
  const storage = getStorage()
  for (const m of materials) {
    if (!m.fileUrl) continue
    try {
      await storage.remove(m.fileUrl)
    } catch (err) {
      console.error(`[deleteAccount] 删除材料文件失败 ${m.fileUrl}`, err)
    }
  }

  /**
   * ⚠️ 免费评估留资(Lead)必须**显式删除**。
   *
   *    Lead.convertedUserId 是 SetNull,所以级联**不会**删它 ——
   *    而它存着手机号、GPA、语言成绩、目标地区、完整评估结果和提交 IP。
   *    在这之前注销账号后这一整行都留在库里,连同手机号 ——
   *    这是 PIPL 删除权的实打实违规,而且和支付记录不同,
   *    它**没有任何财税留存理由**。
   *
   *    按手机号删而不是按 convertedUserId:同一个手机号可能在注册前
   *    做过好几次免费评估,那些 Lead 的 convertedUserId 是空的,
   *    但它们同样是这个人的个人信息。
   */
  await db.lead.deleteMany({ where: { phone: user.phone } })

  /**
   * ⚠️ 这里**不再**写 refundReason。
   *
   *    原来是 `payment.updateMany({ data: { refundReason: '用户已注销账号' } })`,
   *    两个问题:
   *      1. 纯无用功 —— 当时 Payment 是 onDelete: Cascade,下一行 user.delete()
   *         一级联就把刚更新的那些行删了。也就是说隐私政策承诺的
   *         「支付记录保留但解绑」,实际执行的是「直接删掉」。
   *      2. 字段用错了 —— refundReason 是退款原因,拿它记注销会污染退款报表。
   *
   *    现在 Payment 与 ServiceOrder 都是可空 + SetNull(见 schema 注释),
   *    user.delete() 之后它们的 userId 自动变成 null —— **解绑本身就是标记**,
   *    不需要往别的字段里塞话。
   *
   *    其余数据(材料、文书、素材库、推荐人、时间轴、订阅、通知、埋点)
   *    仍然靠级联真删,这是对的。
   */
  await db.user.delete({ where: { id: user.id } })
  await destroySession()

  return { ok: true as const }
}
