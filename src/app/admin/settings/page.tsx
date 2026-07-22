import { requireAdmin } from '@/lib/auth/session'
import { getLlmConfigForDisplay } from '@/lib/settings'
import { SettingsForm } from './SettingsForm'

export default async function AdminSettingsPage() {
  await requireAdmin('super_admin')
  const current = await getLlmConfigForDisplay()

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">AI 设置</h1>
        <p className="mt-1 text-sm text-ink-600">
          配置好之后,「AI 采集」才能工作。文书工作台的 AI 功能也用这套配置。
        </p>
      </div>
      <SettingsForm current={current} />
    </div>
  )
}
