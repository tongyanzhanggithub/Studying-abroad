import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { track } from '@/lib/analytics'
import { regenerateMaterials, syncApplicationStatuses } from '@/lib/materials/generate'
import type { ApplicationStatus, TierTag } from '@prisma/client'

const TIERS: TierTag[] = ['reach', 'match', 'safe']
const STATUSES: ApplicationStatus[] = [
  'not_started',
  'preparing_materials',
  'writing_essay',
  'ready_to_submit',
  'submitted',
  'interview_invited',
  'admitted',
  'rejected',
  'waitlisted',
]

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 })
}

export async function POST(request: Request) {
  const user = await requireUser()
  const body = (await request.json().catch(() => null)) as {
    action?: string
    choiceId?: string
    programId?: string
    tierTag?: TierTag
    status?: ApplicationStatus
  } | null

  if (!body?.action) return badRequest('缺少操作类型')

  if (body.action === 'add') {
    if (!body.programId) return badRequest('缺少项目 ID')
    if (!body.tierTag || !TIERS.includes(body.tierTag)) return badRequest('选校档位不正确')

    const existing = await db.userSchoolChoice.findUnique({
      where: { userId_programId: { userId: user.id, programId: body.programId } },
    })
    if (existing) return badRequest('已经在你的选校单里了')

    const count = await db.userSchoolChoice.count({ where: { userId: user.id } })
    const choice = await db.userSchoolChoice.create({
      data: { userId: user.id, programId: body.programId, tierTag: body.tierTag, sort: count },
    })
    await regenerateMaterials(user.id)
    await track('school_added', {
      userId: user.id,
      properties: { programId: body.programId, tierTag: body.tierTag },
    })
    return NextResponse.json({ ok: true, choiceId: choice.id })
  }

  if (!body.choiceId) return badRequest('缺少选校记录 ID')

  if (body.action === 'remove') {
    const res = await db.userSchoolChoice.deleteMany({
      where: { id: body.choiceId, userId: user.id },
    })
    if (res.count === 0) return badRequest('这条选校记录不存在,请刷新后再试')
    await regenerateMaterials(user.id)
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'tier') {
    if (!body.tierTag || !TIERS.includes(body.tierTag)) return badRequest('选校档位不正确')
    const res = await db.userSchoolChoice.updateMany({
      where: { id: body.choiceId, userId: user.id },
      data: { tierTag: body.tierTag },
    })
    if (res.count === 0) return badRequest('这条选校记录不存在,请刷新后再试')
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'status') {
    if (!body.status || !STATUSES.includes(body.status)) return badRequest('申请状态不正确')
    const res = await db.userSchoolChoice.updateMany({
      where: { id: body.choiceId, userId: user.id },
      data: {
        status: body.status,
        statusManuallySet: true,
        submittedAt: body.status === 'submitted' ? new Date() : undefined,
      },
    })
    if (res.count === 0) return badRequest('这条选校记录不存在,请刷新后再试')
    await syncApplicationStatuses(user.id)
    return NextResponse.json({ ok: true })
  }

  return badRequest('不支持的操作')
}
