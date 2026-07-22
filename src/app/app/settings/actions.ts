'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
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

  const [profile, choices, materials, essays, orders, subscriptions] = await Promise.all([
    db.profile.findUnique({ where: { userId: user.id } }),
    db.userSchoolChoice.findMany({
      where: { userId: user.id },
      include: { program: { include: { school: true } } },
    }),
    db.userMaterial.findMany({ where: { userId: user.id }, include: { template: true } }),
    db.essay.findMany({
      where: { userId: user.id },
      include: { versions: true, aiSessions: true },
    }),
    db.serviceOrder.findMany({ where: { userId: user.id }, include: { sku: true } }),
    db.subscription.findMany({ where: { userId: user.id }, include: { plan: true } }),
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

  // 财税留存:支付记录解绑而非删除
  await db.payment.updateMany({
    where: { userId: user.id },
    data: { refundReason: '用户已注销账号' },
  })

  await db.user.delete({ where: { id: user.id } })
  await destroySession()

  return { ok: true as const }
}
