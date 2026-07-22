import Link from 'next/link'

/**
 * 用户协议。
 *
 * ⚠️ 技术草稿,非法律文件。上线前必须经执业律师审核。
 *    重点条款(不承诺录取、退款规则、AI 使用责任)必须与产品实际行为一致。
 */
export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <Link href="/" className="text-sm text-brand-600 hover:underline">
        ← 返回首页
      </Link>

      <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>开发提示(上线前删除):</strong>
        本文档是与产品实际行为对齐的技术草稿,尚未经法律审核。
      </div>

      <h1 className="mt-8 text-2xl font-semibold text-ink-900">用户协议</h1>
      <p className="mt-1 text-sm text-ink-400">版本 2026-07-v1</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-ink-800">
        <section>
          <h2 className="mb-2 font-semibold">一、服务性质</h2>
          <p>
            Compass 提供留学申请信息服务与申请管理软件工具。我们<strong>不是留学中介</strong>,
            不代理申请、不代为递交、不代你持有申请账号,也<strong>不提供学科类培训</strong>。
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">二、我们不承诺录取结果</h2>
          <p>
            本服务提供的所有选校定位、概率区间、录取要求信息,均为
            <strong>基于公开数据的参考性预估</strong>,不构成对任何录取结果的承诺或保证。
          </p>
          <p className="mt-1">
            录取决定完全由院校做出,受当年申请人数、名额变化、评审标准调整、
            个人软性背景等诸多因素影响。任何声称能「保录取」的说法都不可信,
            我们也从不作此类表述。
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">三、院校数据的准确性</h2>
          <p>
            我们尽力保持院校数据准确,并为每条数据标注最后核对日期与官方来源链接。
            但院校信息可能随时变更,<strong>最终以院校官网为准</strong>。
            对于未经人工核对或超过 30 天未核对的数据,我们会在界面上明确标注,
            请你务必自行到官网复核。
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">四、AI 写作辅助与学术诚信</h2>
          <p>
            本服务的 AI 功能定位为<strong>你的写作工具</strong>:通过提问帮你挖掘素材、
            提供结构建议、进行逐句语法润色。我们<strong>不提供、也不会提供代写或一键生成全文功能</strong>。
          </p>
          <p className="mt-1">
            你有责任确保提交给院校的文书内容真实反映你本人的经历与观点,
            并遵守目标院校的 AI 使用政策。若申请系统要求声明 AI 使用情况,请如实填写。
          </p>
          <p className="mt-1">
            <strong>因违反院校学术诚信规定导致的后果由你本人承担。</strong>
            我们会在文书工作台提示各校 AI 政策,但该提示仅供参考,不替代你对院校规定的核实义务。
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">五、付费与退款</h2>
          <p><strong>系统季票</strong>(预付费):</p>
          <p>· 购买后 7 天内且核心功能使用少于 3 次 —— 全额退款</p>
          <p>· 超过上述条件 —— 按剩余月份阶梯退款,剩余不足 1 个月不予退款</p>
          <p className="mt-2"><strong>单点人工服务</strong>:</p>
          <p>· 交付人接单前 —— 全额退款</p>
          <p>· 已接单未交付 —— 退 50%</p>
          <p>· 已交付 —— 不予退款</p>
          <p className="mt-2">
            服务交付后 48 小时内你未提出异议的,视为验收通过。
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">六、人工服务的性质</h2>
          <p>
            人工服务提供的是专业意见与判断参考,最终决策与递交由你本人完成。
            服务提供者不代写文书、不代为递交申请、不承诺录取结果。
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">七、账号与数据</h2>
          <p>
            你的申请材料、文书内容、院校账号均归你所有。你可随时导出全部数据或注销账号。
            详见<Link href="/legal/privacy" className="text-brand-600 hover:underline">《隐私政策》</Link>。
          </p>
        </section>
      </div>
    </main>
  )
}
