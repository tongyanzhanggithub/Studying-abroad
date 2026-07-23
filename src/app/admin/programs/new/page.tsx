import Link from 'next/link'
import { requireAdmin } from '@/lib/auth/session'
import { NewProgramForm } from './NewProgramForm'

/**
 * 人工新增院校项目。
 *
 * 采集有两条并行的路:AI 采集(批量、快、需逐条审)与人工录入(单条、准、
 * 直接照官网敲)。此前只有前者有入口,运营想加一个项目得绕道 Excel 导入。
 */
export default async function NewProgramPage() {
  await requireAdmin('data_entry')

  return (
    <div className="space-y-5">
      <div>
        <Link href="/admin/programs" className="text-sm text-ink-500 hover:text-ink-900">
          ← 返回院校库
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-ink-900">人工新增院校项目</h1>
        <p className="mt-1 text-sm leading-relaxed text-ink-600">
          先填能唯一定位这个项目的信息,创建后会进入详情页,继续补录取要求、学费和截止日。
          要一次加很多条,用院校库页的「从 Excel 导入」更快。
        </p>
      </div>

      <NewProgramForm />
    </div>
  )
}
