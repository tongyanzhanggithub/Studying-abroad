import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { Card } from '@/components/ui'
import { TimelineEditor } from './TimelineEditor'
import { sortTimeline, findGaps } from '@/lib/profile/timeline'

/**
 * 网申信息 —— 教育与工作经历时间轴 + 护照姓名拼音。
 *
 * ── 这一页刻意**不收**什么 ────────────────────────────
 *
 * 行业里那份《申请人信息表》有八个部分,其中一半这里不做:
 *   · 身份证号、护照号 —— 国内按敏感个人信息处理,需单独同意与必要性论证。
 *     而学生填网申时照着自己的证件念就行,存进库里只是多一个泄露面。
 *   · 监护人的姓名/身份证号/手机/邮箱/住址 —— 那是**第三方**的敏感信息,
 *     学生无权代为同意。
 *   · 婚姻状况、配偶信息、QQ 号、住宅电话 —— 对硕士申请基本用不上。
 *
 * 那份表格收这些,是因为它同时服务于**签证代办**;那是另一条业务线的需求,
 * 不该顺手带进一个学生自助工具里。收集个人信息要有必要性,这是底线。
 *
 * ── 相对纸质表格的增量 ────────────────────────────────
 *
 * 把教育和工作合并成一条时间轴,于是「哪儿有空档」变成可计算的。
 * 那份表格专门有一节「空闲时段说明」要学生自己对着日期算 —— 表格做不到,产品能。
 */
export default async function ProfilePage() {
  const user = await requireUser()

  const [entries, profile] = await Promise.all([
    db.timelineEntry.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        kind: true,
        startYm: true,
        endYm: true,
        organization: true,
        role: true,
        description: true,
      },
    }),
    db.profile.findUnique({
      where: { userId: user.id },
      select: { passportSurname: true, passportGivenName: true },
    }),
  ])

  const sorted = sortTimeline(entries)
  const gaps = findGaps(sorted)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">网申信息</h1>
        <p className="mt-1 text-sm leading-relaxed text-ink-600">
          每所学校的网申表格都要填一遍教育和工作经历。在这儿理一次,之后照着填就行。
        </p>
      </div>

      {entries.length === 0 && (
        <Card className="border-brand-200 bg-brand-50/40">
          <h2 className="font-medium text-ink-900">从本科开始往后填</h2>
          <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-ink-700">
            <li>· 申请硕士的,一般从<strong>高中或本科</strong>起算</li>
            <li>· 学校和单位都要写<strong>全称</strong>,网申不接受简称</li>
            <li>· 一边读书一边实习的,分成两条填 —— 时间重叠没关系</li>
            <li>· 中间有空档的,用「其他」补一条说明在做什么</li>
          </ul>
        </Card>
      )}

      <TimelineEditor
        entries={sorted}
        gaps={gaps}
        passportSurname={profile?.passportSurname ?? null}
        passportGivenName={profile?.passportGivenName ?? null}
      />

      <Card className="bg-ink-50">
        <p className="text-sm leading-relaxed text-ink-600">
          {/*
            ⚠️ 这段说明为什么这里没有身份证号那些字段,不要删。
               用户对着别处的表格会问「怎么少了一半」,得给他一个答案。
          */}
          <strong className="text-ink-900">这里为什么不问身份证号和家庭信息?</strong>
          证件号码你填网申时照着证件念就行,存在我们这儿只会多一份风险;
          父母的证件和联系方式属于他们自己的信息,不该由你替他们提交给第三方。
          需要这些的场景只有签证代办,而我们不做代办。
        </p>
      </Card>
    </div>
  )
}
