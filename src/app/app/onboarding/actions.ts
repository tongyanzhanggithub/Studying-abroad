'use server'

import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { track } from '@/lib/analytics'
import { regenerateMaterials } from '@/lib/materials/generate'
import type { LanguageType, TierTag, UndergradTier } from '@prisma/client'

export async function completeOnboarding(input: {
  profile: {
    undergradTier: string | null
    gpa: number | null
    gpaScale: string
    languageType: string | null
    languageScore: number | null
  }
  selected: Array<{ programId: string; tier: string }>
}) {
  const user = await requireUser()

  await db.profile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      undergradTier: (input.profile.undergradTier as UndergradTier) ?? null,
      gpa: input.profile.gpa,
      gpaScale: input.profile.gpaScale,
      languageType: (input.profile.languageType as LanguageType) ?? null,
      languageScore: input.profile.languageScore,
    },
    update: {
      undergradTier: (input.profile.undergradTier as UndergradTier) ?? null,
      gpa: input.profile.gpa,
      gpaScale: input.profile.gpaScale,
      languageType: (input.profile.languageType as LanguageType) ?? null,
      languageScore: input.profile.languageScore,
    },
  })

  for (const [i, s] of input.selected.entries()) {
    await db.userSchoolChoice.upsert({
      where: { userId_programId: { userId: user.id, programId: s.programId } },
      create: {
        userId: user.id,
        programId: s.programId,
        tierTag: s.tier as TierTag,
        sort: i,
      },
      update: {},
    })
  }

  await regenerateMaterials(user.id)
  await track('onboarding_complete', {
    userId: user.id,
    properties: { schoolCount: input.selected.length },
  })

  return { ok: true as const }
}
