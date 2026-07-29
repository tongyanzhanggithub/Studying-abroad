'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { validateEntry } from '@/lib/profile/timeline'
import type { TimelineKind } from '@prisma/client'

const VALID_KINDS: TimelineKind[] = ['education', 'work', 'other']
/** 一个人的完整经历不会有几十条;设上限防止被当成任意写入接口 */
const MAX_ENTRIES = 40

export async function savePassportName(input: { surname: string; givenName: string }) {
  const user = await requireUser()

  /**
   * ⚠️ 只留字母、空格、连字符、撇号,并转成大写。
   *
   *    护照上的姓名拼音就是大写拉丁字母。这里做归一化不是洁癖 ——
   *    这个字段存在的全部意义就是「让所有材料的拼法一致」,
   *    如果它自己就允许存进中文或全角空格,那它一点用都没有。
   */
  const clean = (v: string) =>
    v
      .trim()
      .replace(/[^A-Za-z\s'-]/g, '')
      .replace(/\s+/g, ' ')
      .toUpperCase()
      .slice(0, 60)

  await db.profile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      passportSurname: clean(input.surname) || null,
      passportGivenName: clean(input.givenName) || null,
    },
    update: {
      passportSurname: clean(input.surname) || null,
      passportGivenName: clean(input.givenName) || null,
    },
  })

  revalidatePath('/app/profile')
  return { ok: true as const }
}

export async function saveTimelineEntry(input: {
  id?: string
  kind: string
  startYm: string
  endYm: string
  organization: string
  role: string
  description: string
}) {
  const user = await requireUser()

  if (!VALID_KINDS.includes(input.kind as TimelineKind)) {
    return { ok: false as const, error: '经历类型不正确。' }
  }

  const organization = input.organization.trim()
  if (!organization) {
    return { ok: false as const, error: '请填写学校或单位的全称。' }
  }

  const startYm = input.startYm.trim()
  const endYm = input.endYm.trim() || null

  // 时间校验走和展示同一套纯函数,不在这里另写一遍规则
  const err = validateEntry(startYm, endYm)
  if (err) return { ok: false as const, error: err }

  const data = {
    kind: input.kind as TimelineKind,
    startYm,
    endYm,
    organization: organization.slice(0, 200),
    role: input.role.trim().slice(0, 200) || null,
    description: input.description.trim().slice(0, 2000) || null,
  }

  if (input.id) {
    // ⚠️ updateMany + userId:一步完成归属校验与更新,不存在「先查后改」的空隙
    const res = await db.timelineEntry.updateMany({
      where: { id: input.id, userId: user.id },
      data,
    })
    if (res.count === 0) return { ok: false as const, error: '这条经历不存在。' }
  } else {
    const count = await db.timelineEntry.count({ where: { userId: user.id } })
    if (count >= MAX_ENTRIES) {
      return { ok: false as const, error: `最多添加 ${MAX_ENTRIES} 条经历。` }
    }
    await db.timelineEntry.create({ data: { ...data, userId: user.id } })
  }

  revalidatePath('/app/profile')
  return { ok: true as const }
}

export async function deleteTimelineEntry(id: string) {
  const user = await requireUser()
  const res = await db.timelineEntry.deleteMany({ where: { id, userId: user.id } })
  if (res.count === 0) return { ok: false as const, error: '这条经历不存在。' }

  revalidatePath('/app/profile')
  return { ok: true as const }
}
