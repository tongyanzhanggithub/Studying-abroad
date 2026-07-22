'use server'

import { requireUser } from '@/lib/auth/session'
import { recordClick, recordDismiss } from '@/lib/recommendation/engine'

export async function dismissCard(ruleId: string) {
  const user = await requireUser()
  await recordDismiss(user.id, ruleId)
}

export async function clickCard(ruleId: string) {
  const user = await requireUser()
  await recordClick(user.id, ruleId)
}
