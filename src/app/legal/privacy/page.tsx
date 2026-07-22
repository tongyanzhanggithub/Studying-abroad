import Link from 'next/link'

/**
 * 隐私政策。
 *
 * ⚠️ 这是**技术草稿,不是法律文件**。上线前必须由执业律师依据
 *    《个人信息保护法》《数据安全法》及现行网络安全规定审核定稿。
 *    下方内容仅确保产品实际行为与声明一致,不构成合规意见。
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <Link href="/" className="text-sm text-brand-600 hover:underline">
        ← 返回首页
      </Link>

      <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>开发提示(上线前删除):</strong>
        本文档是与产品实际行为对齐的技术草稿,尚未经法律审核。
        正式上线前必须由执业律师依《个人信息保护法》审核定稿。
      </div>

      <h1 className="mt-8 text-2xl font-semibold text-ink-900">隐私政策</h1>
      <p className="mt-1 text-sm text-ink-400">版本 2026-07-v1</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-ink-800">
        <section>
          <h2 className="mb-2 font-semibold">一、我们收集哪些信息</h2>
          <p>1. <strong>手机号</strong>:用于账号登录、找回,以及申请截止日期提醒。这是使用本服务的必要信息。</p>
          <p className="mt-1">2. <strong>教育背景信息</strong>(本科院校层级、专业、GPA、语言成绩):用于生成选校定位结果与文书合规提示。你可以选择不填,但相关功能将无法使用。</p>
          <p className="mt-1">3. <strong>你上传的申请材料与文书内容</strong>:仅用于向你本人提供申请管理与写作辅助功能。</p>
          <p className="mt-1">4. <strong>使用行为数据</strong>(页面访问、功能使用记录):用于改进产品。</p>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">二、我们如何使用这些信息</h2>
          <p>仅用于向你提供本服务。具体包括:生成选校评估结果、自动生成材料清单、发送截止日期与院校数据变更提醒、提供 AI 写作辅助。</p>
          <p className="mt-1">
            如你购买人工服务,我们会在<strong>你下单后</strong>,将该服务所必需的最小范围信息
            (如你指定的文书内容)提供给对应交付人。交付人受保密义务约束。
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">三、我们不做什么</h2>
          <p>· 不向第三方出售你的个人信息。</p>
          <p>· 不将你的文书内容用于训练模型。</p>
          <p>· 不在未经你下单的情况下,向任何交付人或第三方展示你的材料。</p>
          <p>· 不代你持有院校申请账号或申请邮箱。</p>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">四、AI 功能与数据处理</h2>
          <p>
            文书辅助功能会将你选中的文本发送至大模型服务商进行处理。我们优先使用境内合规模型服务,
            用户数据存储于境内服务器。当前使用的服务商可在设置页查看。
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">五、存储与安全</h2>
          <p>数据传输使用 TLS 加密,文件存储加密,访问权限控制到行级 —— 你的数据只有你本人和你授权的交付人可见。</p>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">六、你的权利</h2>
          <p>
            你可以随时在「设置 → 你的数据」中<strong>导出全部数据</strong>或<strong>注销账号</strong>。
            注销后我们将删除你的个人信息与业务数据;支付记录因财税法规要求需保留,但会与你的身份解绑。
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">七、未成年人</h2>
          <p>
            如你未满 18 周岁,请在监护人同意并陪同下使用本服务。
            我们不会在明知的情况下向未成年人单独收集非必要信息。
          </p>
        </section>
      </div>
    </main>
  )
}
