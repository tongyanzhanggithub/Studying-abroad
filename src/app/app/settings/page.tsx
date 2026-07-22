import Link from 'next/link'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { DataControls } from './Controls'
import { UNDERGRAD_TIER_LABEL, UNDERGRAD_MAJOR_OPTIONS } from '@/lib/programs/types'

/**
 * 账号设置(PRD 3.1 / 10.3)。
 *
 * ⚠️ 合规必备:提供**数据导出**与**账号注销**入口。
 *    这不是可选功能 —— 《个人信息保护法》要求个人有权查阅、复制、删除其个人信息。
 */
export default async function SettingsPage() {
  const user = await requireUser()
  const profile = await db.profile.findUnique({ where: { userId: user.id } })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-ink-900">设置</h1>

      <Card>
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-medium text-ink-900">我的背景</h2>
          <Link
            href="/app/assessments"
            className="shrink-0 text-sm text-brand-600 hover:underline"
          >
            去评估页编辑 →
          </Link>
        </div>
        <p className="mt-1 mb-3 text-sm leading-relaxed text-ink-600">
          背景资料现在和评估放在一起管理 —— 改完能立刻重算。这里只作展示。
        </p>
        {profile?.undergradTier ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-ink-400">本科院校层级</dt>
              <dd className="text-ink-800">
                {UNDERGRAD_TIER_LABEL[profile.undergradTier] ?? profile.undergradTier}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-400">本科学科门类</dt>
              <dd className="text-ink-800">
                {UNDERGRAD_MAJOR_OPTIONS.find((m) => m.value === profile.undergradMajor)
                  ?.description ??
                  profile.undergradMajor ??
                  '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-400">GPA</dt>
              <dd className="text-ink-800">
                {profile.gpa ?? '—'}
                {profile.gpa != null && (profile.gpaScale === '100' ? ' / 百分制' : ' / 4 分制')}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-400">语言成绩</dt>
              <dd className="text-ink-800">
                {profile.languageType && profile.languageType !== 'none'
                  ? `${profile.languageType === 'ielts' ? '雅思' : '托福'} ${profile.languageScore ?? '—'}` +
                    (profile.languageMinBand != null ? ` (最低单项 ${profile.languageMinBand})` : '')
                  : '还没考'}
              </dd>
            </div>
            {profile.isMajorSwitch && (
              <div>
                <dt className="text-xs text-ink-400">申请类型</dt>
                <dd className="text-ink-800">转专业申请</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="text-sm text-ink-500">
            还没填背景资料。
            <Link href="/app/assessments" className="ml-1 text-brand-600 hover:underline">
              去填一下 →
            </Link>
          </p>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-medium text-ink-900">账号</h2>
        <p className="text-sm text-ink-600">手机号 {user.phone}</p>
        <p className="mt-1 text-xs text-ink-400">
          {user.agreedTermsAt
            ? `已于 ${user.agreedTermsAt.toLocaleDateString('zh-CN')} 同意用户协议(版本 ${user.agreedTermsVersion})`
            : ''}
        </p>
      </Card>

      <Card>
        <h2 className="mb-2 font-medium text-ink-900">你的数据</h2>
        <p className="mb-4 text-sm leading-relaxed text-ink-600">
          你的申请材料、文书、选校单都属于你。可以随时导出全部数据,
          也可以随时注销账号并删除所有信息。
        </p>
        <DataControls />
      </Card>
    </div>
  )
}
