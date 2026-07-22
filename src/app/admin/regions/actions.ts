'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { getRegionHealth } from '@/lib/regions/gate'
import type { Region } from '@prisma/client'

/**
 * 开放 / 关闭一个地区。
 *
 * ⚠️ 开放前强制复核门槛 —— 前端按钮虽然只在达标时才可点,
 *    但服务端不能信任前端。这一步直接决定用户看到的数据是否经过核对。
 * ⚠️ 关闭永远允许,不设门槛:发现数据有问题时要能立刻撤下来。
 */
export async function setRegionPublic(region: Region, isPublic: boolean) {
  const admin = await requireAdmin('super_admin')

  if (isPublic) {
    const health = (await getRegionHealth()).find((h) => h.region === region)
    if (!health) {
      return { ok: false as const, error: '找不到该地区的数据' }
    }
    if (!health.meetsBar) {
      const reasons: string[] = []
      if (health.total < health.minPrograms) {
        reasons.push(`项目数 ${health.total},门槛 ${health.minPrograms}`)
      }
      if (health.verifiedRate < health.minVerifiedRate) {
        reasons.push(
          `核对率 ${Math.round(health.verifiedRate * 100)}%,门槛 ${Math.round(health.minVerifiedRate * 100)}%`,
        )
      }
      return { ok: false as const, error: `未达开放门槛(${reasons.join(';')})` }
    }
  }

  await db.regionSetting.upsert({
    where: { region },
    create: {
      region,
      isPublic,
      publishedAt: isPublic ? new Date() : null,
      publishedBy: isPublic ? admin.adminId : null,
    },
    update: {
      isPublic,
      publishedAt: isPublic ? new Date() : null,
      publishedBy: isPublic ? admin.adminId : null,
    },
  })

  // 用户侧全部受影响
  revalidatePath('/')
  revalidatePath('/assess')
  revalidatePath('/app/schools')
  revalidatePath('/admin/regions')
  return { ok: true as const }
}

/** 调整某地区的开放门槛与备注 */
export async function updateRegionBar(
  region: Region,
  input: { minVerifiedRate: number; minPrograms: number; note: string },
) {
  await requireAdmin('super_admin')

  const rate = Number(input.minVerifiedRate)
  const count = Number(input.minPrograms)
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    return { ok: false as const, error: '核对率门槛必须在 0 到 1 之间' }
  }
  if (!Number.isInteger(count) || count < 0) {
    return { ok: false as const, error: '项目数门槛必须是非负整数' }
  }

  await db.regionSetting.upsert({
    where: { region },
    create: {
      region,
      minVerifiedRate: rate,
      minPrograms: count,
      note: input.note.trim() || null,
    },
    update: {
      minVerifiedRate: rate,
      minPrograms: count,
      note: input.note.trim() || null,
    },
  })

  revalidatePath('/admin/regions')
  return { ok: true as const }
}
