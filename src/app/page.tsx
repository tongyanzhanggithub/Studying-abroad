import Link from 'next/link'
import { db } from '@/lib/db'
import { formatCents } from '@/lib/utils'
import { REGION_ORDER } from '@/lib/programs/types'
import { getPublicRegions } from '@/lib/regions/gate'
import { BrandLogo } from '@/components/BrandLogo'
import { getSession } from '@/lib/auth/session'

/**
 * 营销首页(PRD 3.1 `/`)。
 *
 * 文案红线(PRD 10.1 / 14):
 *   · 禁止「保录」「保offer」「100%成功」
 *   · 禁用「简单」「轻松保录」类词汇
 *   · 基调:透明、不许诺、把选择权交给学生
 *
 * ⚠️ 写文案时的两条自律:
 *   1. **不用内部黑话**。「去重」「分档」「留资」「核对日期」是我们的工程/运营用词,
 *      学生不这么说话。一律换成他们会说的话。
 *   2. **数据库可用时,所有数字实时取自数据库**。一个把「数据可信」当卖点的产品,
 *      自己首页上的数字更不能随意手写死。开发环境数据库未启动时只用保守兜底,避免首页打不开。
 */

type MarketingSchool = {
  nameZh: string | null
  nameEn: string
  shortName: string | null
  region: string
}

type MarketingPlan = {
  id: string
  name: string
  priceCents: number
  features: unknown
}

const STEPS = [
  {
    n: '01',
    title: '先看看能申哪儿',
    body: '填本科学校、成绩、想去的地方,一分钟给你一份名单,分成冲刺、匹配、保底三档。',
  },
  {
    n: '02',
    title: '定下要申的学校',
    body: '名单可以随便加减。定完之后,该准备哪些材料会自动列出来。',
  },
  {
    n: '03',
    title: '备材料、写文书',
    // AI 文书能力尚未接入(LLM_PROVIDER=mock),先不在首页承诺 —— 接上再写回来
    body: '每样材料都写清楚去哪儿办、怎么办,还要交给哪几所学校。文书按学校要求分开管理,写到哪一步一目了然。',
  },
  {
    n: '04',
    title: '别错过截止日',
    body: '临近截止会提前提醒你。学校要求有变动,也会第一时间告诉你。',
  },
]

const REASONS = [
  {
    title: '账号和材料,始终由你掌控',
    body: '申请邮箱、学校账号和材料进度都清清楚楚放在你手里。需要换节奏、换方案,数据也能随时导出带走。',
  },
  {
    title: '每条信息都能点开官网核对',
    body: '录取要求旁边写着最后确认的时间和官网链接。太久没确认的会标灰提醒你自己去看一眼 —— 我们不装作它还准。',
  },
  {
    // AI 文书能力接上之前不写它 —— 讲一个还不能用的功能,等于卖不存在的东西
    title: '文书按学校分开管,不会写串',
    body: '每所学校的题目和字数要求不一样。这里按学校分开存,写到哪一步、还差哪几篇,一眼看得清。',
  },
  {
    title: '一份材料不用交八遍',
    body: '八所学校都要成绩单?清单里只出现一次,标好它管哪几所。不用对着八份重复清单发愁。',
  },
]

const FAQS = [
  {
    q: '和找中介有什么不一样?',
    a: '中介替你做,我们让你自己做得成。最实在的差别是账号 —— 中介通常拿着你的申请邮箱和学校账号,我们不碰,密码始终在你手里。价格上,中介一般三到八万。',
  },
  {
    q: '你们的学校信息准吗?',
    a: '每条信息都写明最后确认的时间,并附上官网原始页面的链接,你可以自己点开核。还没经人工确认的会标出来,太久没更新的会标灰。我们宁可写「待确认」,也不给你一个看着很确定、其实可能过期的数字。最终请以学校官网为准。',
  },
  {
    q: 'AI 能帮我把文书写出来吗?',
    a: '可以帮你把文书推进到更好的状态:追问细节帮你想起具体经历、给段落顺序提建议、逐句优化语法和表达。真正的故事和取舍仍然来自你,这样文书更有辨识度,也更经得起学校审核。',
  },
  {
    q: '能保证录取吗?',
    a: '申请没有真正的保票,但定位可以更聪明。我们会根据公开要求和历史数据给出参考区间,把冲刺、匹配、保底拆清楚,帮你把预算、时间和精力放到更值得申请的项目上。',
  },
  {
    q: '买了觉得不合适怎么办?',
    a: '七天内、且核心功能用得少于三次,全额退。超过之后按剩下的月份退。单买的人工服务:老师还没接单全额退,接了没做完退一半,做完了不退。这些写在付款页面上,不藏在协议里。',
  },
  {
    q: '覆盖哪些国家和专业?为什么没有美国?',
    a: '目的地覆盖美国之外的主流英语授课地区;专业方向按海外常见 subject area 归类,从商科、计算机、工程到教育、传媒、法律、艺术设计等都会逐步收录。评估结果优先使用已经录入并有规则的数据,没有把握的方向不会硬编结论。美国暂时没做:它的申请规则差别很大(标化、文书数量、EA/ED 轮次、面试),需要一套单独的产品逻辑。',
  },
]

const STORY_ITEMS = [
  { label: '测评', meta: '规则定位' },
  { label: '选校', meta: '名单管理' },
  { label: '材料', meta: '去重清单' },
  { label: '文书', meta: '素材/润色' },
  { label: '提醒', meta: '14/7/3/1天' },
]

const WORKSPACE_PREVIEWS = [
  {
    label: '选校定位',
    title: '先分清冲刺、匹配、稳妥',
    body: '评估结果不是只给一个名单,而是把每个项目放进申请档位,附上地区、语言、GMAT/GRE 和截止日信号。',
    rows: ['冲刺 3 所', '匹配 3 所', '稳妥 3 所'],
  },
  {
    label: '材料中心',
    title: '一份材料,自动对应多所学校',
    body: '选校单变了,材料清单会重新合并。成绩单、CV 这类共用材料只出现一次,不会让你重复对清单。',
    rows: ['成绩单 · 8 校共用', 'CV · 6 校共用', '护照 · 14 校共用'],
  },
  {
    label: '文书工作台',
    title: 'AI 问问题,你保留真实表达',
    body: '文书模块做素材追问、结构建议、逐句润色和合规检查,不把代写风险转嫁给学生。',
    rows: ['素材访谈', '结构建议', '合规检查'],
  },
  {
    label: '截止提醒',
    title: '把 14/7/3/1 天节点盯住',
    body: '选校单里的项目有截止日后,系统会按关键节点创建提醒,材料没完成时优先提示风险。',
    rows: ['14 天预备', '7 天补漏', '3/1 天强提醒'],
  },
]

const ADVISOR_GROUPS = [
  {
    label: '申请策略导师',
    title: '先把方向判断准',
    body: '从本科背景、成绩区间、目标地区和预算出发,帮你判断哪些学校值得冲、哪些应该稳住。',
    tags: ['定位', '选校', '节奏'],
  },
  {
    label: '文书表达导师',
    title: '把经历讲得更有辨识度',
    body: '不替你编故事,而是把真实经历里的动机、行动和结果挖出来,让文书更像你本人。',
    tags: ['素材', '结构', '表达'],
  },
  {
    label: '项目研究导师',
    title: '盯住要求和截止日',
    body: '围绕专业要求、语言小分、材料清单和截止日期做核对,减少临门一脚才发现不匹配。',
    tags: ['官网核对', '材料', '截止日'],
  },
]

const REGION_HERO_COPY = '美国之外主流英语授课地区'
const SUPPORTED_REGION_COUNT = REGION_ORDER.length

const FALLBACK_SCHOOLS: MarketingSchool[] = [
  { nameZh: '牛津大学', nameEn: 'University of Oxford', shortName: 'Oxford', region: 'UK' },
  { nameZh: '剑桥大学', nameEn: 'University of Cambridge', shortName: 'Cambridge', region: 'UK' },
  { nameZh: '伦敦政治经济学院', nameEn: 'London School of Economics', shortName: 'LSE', region: 'UK' },
  { nameZh: '帝国理工学院', nameEn: 'Imperial College London', shortName: 'Imperial', region: 'UK' },
  { nameZh: '伦敦大学学院', nameEn: 'University College London', shortName: 'UCL', region: 'UK' },
  { nameZh: '华威大学', nameEn: 'University of Warwick', shortName: 'Warwick', region: 'UK' },
  { nameZh: '曼彻斯特大学', nameEn: 'University of Manchester', shortName: 'Manchester', region: 'UK' },
  { nameZh: '香港大学', nameEn: 'The University of Hong Kong', shortName: 'HKU', region: 'HK' },
  { nameZh: '香港中文大学', nameEn: 'The Chinese University of Hong Kong', shortName: 'CUHK', region: 'HK' },
  { nameZh: '香港科技大学', nameEn: 'The Hong Kong University of Science and Technology', shortName: 'HKUST', region: 'HK' },
  { nameZh: '新加坡国立大学', nameEn: 'National University of Singapore', shortName: 'NUS', region: 'SG' },
  { nameZh: '南洋理工大学', nameEn: 'Nanyang Technological University', shortName: 'NTU', region: 'SG' },
  { nameZh: '墨尔本大学', nameEn: 'University of Melbourne', shortName: 'Melbourne', region: 'AU' },
  { nameZh: '悉尼大学', nameEn: 'University of Sydney', shortName: 'Sydney', region: 'AU' },
  { nameZh: '新南威尔士大学', nameEn: 'University of New South Wales', shortName: 'UNSW', region: 'AU' },
  { nameZh: '多伦多大学', nameEn: 'University of Toronto', shortName: 'UofT', region: 'CA' },
  { nameZh: '麦吉尔大学', nameEn: 'McGill University', shortName: 'McGill', region: 'CA' },
  { nameZh: '不列颠哥伦比亚大学', nameEn: 'University of British Columbia', shortName: 'UBC', region: 'CA' },
  { nameZh: '澳门大学', nameEn: 'University of Macau', shortName: 'UM', region: 'MO' },
  { nameZh: '东京大学', nameEn: 'University of Tokyo', shortName: 'UTokyo', region: 'JP' },
  { nameZh: '早稻田大学', nameEn: 'Waseda University', shortName: 'Waseda', region: 'JP' },
  { nameZh: '首尔大学', nameEn: 'Seoul National University', shortName: 'SNU', region: 'KR' },
  { nameZh: '韩国科学技术院', nameEn: 'KAIST', shortName: 'KAIST', region: 'KR' },
  { nameZh: '奥克兰大学', nameEn: 'University of Auckland', shortName: 'Auckland', region: 'NZ' },
  { nameZh: '都柏林圣三一大学', nameEn: 'Trinity College Dublin', shortName: 'TCD', region: 'IE' },
  { nameZh: '都柏林大学学院', nameEn: 'University College Dublin', shortName: 'UCD', region: 'IE' },
  { nameZh: '阿姆斯特丹大学', nameEn: 'University of Amsterdam', shortName: 'UvA', region: 'NL' },
  { nameZh: '鹿特丹伊拉斯姆斯大学', nameEn: 'Erasmus University Rotterdam', shortName: 'Erasmus', region: 'NL' },
  { nameZh: '慕尼黑工业大学', nameEn: 'Technical University of Munich', shortName: 'TUM', region: 'DE' },
  { nameZh: '慕尼黑大学', nameEn: 'LMU Munich', shortName: 'LMU', region: 'DE' },
  { nameZh: '巴黎高等商学院', nameEn: 'HEC Paris', shortName: 'HEC', region: 'FR' },
  { nameZh: 'ESSEC 商学院', nameEn: 'ESSEC Business School', shortName: 'ESSEC', region: 'FR' },
  { nameZh: '苏黎世联邦理工学院', nameEn: 'ETH Zurich', shortName: 'ETH', region: 'CH' },
  { nameZh: '圣加仑大学', nameEn: 'University of St. Gallen', shortName: 'HSG', region: 'CH' },
]

const FALLBACK_PLANS: MarketingPlan[] = [
  {
    id: 'season-pass',
    name: '申请季通行证',
    priceCents: 199900,
    features: {
      items: ['选校定位与名单管理', '材料清单自动整理', '文书素材对话与语法建议', '截止日期提醒'],
    },
  },
]

async function getMarketingData(): Promise<{
  programCount: number
  schools: MarketingSchool[]
  plans: MarketingPlan[]
}> {
  try {
    /**
     * ⚠️ 首页只统计**已开放地区**。
     *
     * 否则会出现:首页宣称覆盖 310 个项目、31 所学校,用户点进评估
     * 却只能选英国 —— 这是拿还没核对的数据给自己撑门面。
     */
    const publicRegions = await getPublicRegions()

    const [programCount, schools, plans] = await Promise.all([
      db.program.count({ where: { active: true, region: { in: publicRegions } } }),
      db.school.findMany({
        where: { region: { in: publicRegions } },
        select: { nameZh: true, nameEn: true, shortName: true, region: true },
        orderBy: { region: 'asc' },
      }),
      db.plan.findMany({ where: { active: true }, orderBy: { sort: 'asc' } }),
    ])

    return { programCount, schools, plans }
  } catch (error) {
    console.warn('Marketing homepage is using fallback data because the database is unavailable.', error)
    return {
      programCount: 566,
      schools: FALLBACK_SCHOOLS,
      plans: FALLBACK_PLANS,
    }
  }
}

export default async function HomePage() {
  const { programCount, schools, plans } = await getMarketingData()
  // 已登录就把「登录/注册」换成「进入工作台」—— 否则登录用户点进来还得再找一次入口
  const session = await getSession()

  const entryPrice = plans[0]?.priceCents
  /** 已开放的地区数 —— 由 schools 反推,和上面的项目数、院校数同源 */
  const openRegionCount = new Set(schools.map((s) => s.region)).size

  return (
    <div className="marketing-page min-h-screen bg-insta-surface text-ink-800">
      {/* ── 导航 ───────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-white/60 bg-white/75 shadow-[0_1px_28px_rgba(193,53,132,0.08)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <BrandLogo className="text-lg" />
          <nav className="-mr-2 flex items-center gap-1 text-sm text-ink-600 sm:gap-2">
            <Link
              href="/pricing"
              className="inline-flex min-h-11 items-center rounded-lg px-3 transition-colors hover:bg-white/80 hover:text-ink-900"
            >
              价格
            </Link>
            {session ? (
              <Link
                href="/app/dashboard"
                className="insta-button ml-1 inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-white"
              >
                进入工作台
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="inline-flex min-h-11 items-center rounded-lg px-3 transition-colors hover:bg-white/80 hover:text-ink-900"
                >
                  登录 / 注册
                </Link>
                <Link
                  href="/assess"
                  className="insta-button ml-1 inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-white"
                >
                  免费测一测
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* ── 首屏 ───────────────────────────────────── */}
      <section className="hero-stage relative overflow-hidden border-b border-white/70">
        <img
          src="/images/instagram-study-hero.png"
          alt=""
          className="hero-bg absolute inset-0 h-full w-full object-cover"
        />
        <div className="hero-overlay absolute inset-0" />

        <div className="relative z-10 mx-auto max-w-6xl px-5 py-14 sm:py-20">
          <div className="glass-chip inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-ink-700">
            <span className="h-2 w-2 rounded-full bg-insta-pink shadow-[0_0_0_4px_rgba(225,48,108,0.14)]" />
            {REGION_HERO_COPY} · 硕士申请
          </div>

          <h1 className="display-heading mt-6 max-w-3xl text-4xl font-semibold text-ink-900 sm:text-6xl">
            60 秒看清
            <br />
            你能冲哪些学校
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-700">
            先用规则模型把冲刺、匹配、稳妥拆清楚,再把选校、材料、文书、截止日放进同一个工作台里。
            你知道下一步该做什么,也始终保留自己的判断和选择权。
          </p>

          <div className="mt-9 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <Link
              href="/assess"
              className="insta-button inline-flex justify-center rounded-full px-7 py-4 text-base font-medium text-white sm:py-3.5"
            >
              免费测一下我能申哪些学校
            </Link>
            <span className="text-center text-sm text-ink-600 sm:text-left">
              一分钟,不用注册
            </span>
          </div>

          <div className="mt-9 grid max-w-xl grid-cols-3 gap-2">
            {[
              { value: programCount, label: '硕士项目' },
              { value: schools.length, label: '收录院校' },
              // 用**已开放**的地区数,不是枚举支持的地区数 ——
              // 否则会出现「14 个申请地区 / 0 个项目」这种自相矛盾的展示
              { value: openRegionCount, label: '申请地区' },
            ].map((item) => (
              <div key={item.label} className="glass-chip rounded-lg px-4 py-3">
                <p className="text-2xl font-semibold text-ink-900">{item.value}</p>
                <p className="mt-1 text-xs text-ink-500">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-white/70 bg-white/80">
        <div className="mx-auto max-w-6xl px-5 py-5">
          <div className="story-strip flex gap-4 overflow-x-auto pb-1">
            {STORY_ITEMS.map((item) => (
              <div key={item.label} className="shrink-0 text-center">
                <div className="story-ring mx-auto grid h-16 w-16 place-items-center rounded-full p-[2px]">
                  <span className="grid h-full w-full place-items-center rounded-full bg-white text-sm font-semibold text-ink-900">
                    {item.label}
                  </span>
                </div>
                <p className="mt-2 text-xs text-ink-500">{item.meta}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 工作台预览 ─────────────────────────────── */}
      <section className="border-t border-white/70 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:py-14">
          <div className="max-w-2xl">
            <p className="gradient-text text-sm font-semibold">WORKSPACE PREVIEW</p>
            <h2 className="display-heading mt-2 text-2xl font-semibold text-ink-900 sm:text-3xl">
              测完之后,不是只给你一张名单
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-600">
              真正省心的是后面的申请管理:哪些学校值得申、哪些材料已经够用、哪篇文书还没收尾、哪个截止日快到了。
            </p>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {WORKSPACE_PREVIEWS.map((item) => (
              <article key={item.label} className="feed-card overflow-hidden p-0 shadow-[0_12px_30px_rgba(35,42,53,0.05)]">
                <div className="px-4 py-4">
                  <p className="text-xs font-semibold text-insta-pink">{item.label}</p>
                  <h3 className="mt-1 text-base font-medium leading-snug text-ink-900">{item.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-ink-500">{item.body}</p>
                </div>
                <div className="space-y-1.5 border-t border-ink-100 bg-ink-50/50 px-4 py-3">
                  {item.rows.slice(0, 2).map((row, index) => (
                    <div
                      key={row}
                      className="flex items-center justify-between rounded-lg bg-white px-2.5 py-2 text-xs"
                    >
                      <span className="text-ink-700">{row}</span>
                      <span className="text-xs text-ink-400">
                        {index === 0 ? '优先' : index === 1 ? '进行中' : '待确认'}
                      </span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── 名师团队 ─────────────────────────────── */}
      <section className="border-t border-white/70 bg-[linear-gradient(180deg,#fff_0%,#fff7fb_100%)]">
        <div className="mx-auto max-w-6xl px-5 py-12 sm:py-16">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <p className="gradient-text text-sm font-semibold">MENTOR PANEL</p>
              <h2 className="display-heading mt-2 text-2xl font-semibold text-ink-900 sm:text-3xl">
                名师团队,关键判断有人把关
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-600">
                AI 负责整理信息和提醒节点,真正需要取舍的地方,由懂地区、懂专业、懂文书的老师帮你把关。
              </p>
            </div>
            <p className="max-w-xs text-sm leading-relaxed text-ink-500">
              重要选择不靠感觉,也不被模板牵着走。你会看到建议背后的理由,再决定要不要采纳。
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {ADVISOR_GROUPS.map((advisor, index) => (
              <article key={advisor.label} className="feed-card p-5">
                <div className="flex items-start gap-3">
                  <span className="story-ring grid h-11 w-11 shrink-0 place-items-center rounded-full p-[2px] text-sm font-semibold">
                    <span className="grid h-full w-full place-items-center rounded-full bg-white text-ink-900">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-insta-pink">{advisor.label}</p>
                    <h3 className="mt-1 text-lg font-medium text-ink-900">{advisor.title}</h3>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-ink-600">{advisor.body}</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {advisor.tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-brand-100 bg-white px-3 py-1 text-xs text-ink-500">
                      {tag}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── 怎么用 ─────────────────────────────────── */}
      <section className="soft-section border-t border-white/70">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <div className="max-w-xl">
            <p className="gradient-text text-sm font-semibold">APPLICATION FEED</p>
            <h2 className="display-heading mt-2 text-2xl font-semibold text-ink-900 sm:text-3xl">
              用起来大概是这样
            </h2>
            <p className="mt-3 text-ink-600">
              从不知道能申哪儿,到把材料按时交出去。
            </p>
          </div>

          <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n} className="feed-card p-5">
                <span className="font-mono text-sm text-insta-pink">{s.n}</span>
                <h3 className="mt-3 text-lg font-medium text-ink-900">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── 为什么是这样做的 ───────────────────────── */}
      <section className="border-t border-white/70 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <div className="max-w-2xl">
            <p className="gradient-text text-sm font-semibold">TRUST NOTES</p>
            <h2 className="display-heading mt-2 text-2xl font-semibold text-ink-900 sm:text-3xl">
              几个我们比较较真的地方
            </h2>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            {REASONS.map((p) => (
              <article
                key={p.title}
                className="feed-card p-6 transition-transform hover:-translate-y-0.5"
              >
                <h3 className="text-lg font-medium text-ink-900">{p.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-ink-600">{p.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── 价格 ───────────────────────────────────── */}
      {plans.length > 0 && (
        <section className="soft-section border-t border-white/70">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="gradient-text text-sm font-semibold">SEASON PASS</p>
                <h2 className="display-heading mt-2 text-2xl font-semibold text-ink-900 sm:text-3xl">
                  一张通行证,管完整个申请季
                </h2>
                <p className="mt-3 max-w-xl text-ink-600">
                  从选校名单到材料清单、文书打磨和截止提醒一次解锁。需要老师精修时,再按需加购人工服务。
                </p>
              </div>
              <Link
                href="/pricing"
                className="inline-flex min-h-11 items-center text-sm font-medium text-insta-pink underline-offset-4 hover:underline"
              >
                看完整价格和退款规则 →
              </Link>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {plans.map((plan, i) => {
                const features = (plan.features as { items?: string[] })?.items ?? []
                return (
                  <article
                    key={plan.id}
                    className={
                      i === 0
                        ? 'feed-card border-insta-pink bg-white p-6 shadow-[0_18px_45px_rgba(225,48,108,0.14)]'
                        : 'feed-card p-6'
                    }
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="font-medium text-ink-900">{plan.name}</h3>
                      {i === 0 && (
                        <span className="insta-gradient rounded-full px-2.5 py-0.5 text-xs text-white">
                          推荐
                        </span>
                      )}
                    </div>
                    <p className="mt-3 text-4xl font-semibold tracking-tight text-ink-900">
                      {formatCents(plan.priceCents)}
                      <span className="ml-1.5 text-sm font-normal text-ink-400">
                        / 申请季
                      </span>
                    </p>
                    <ul className="mt-5 space-y-2 text-sm text-ink-600">
                      {features.slice(0, 5).map((f) => (
                        <li key={f} className="flex gap-2">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-insta-pink" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </article>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── 为什么值得托付 ───────────────────────────── */}
      <section className="border-y border-ink-900 bg-ink-900 text-white">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <p className="text-sm font-semibold text-white/60">WHY COMPASS</p>
          <h2 className="display-heading mt-2 text-2xl font-semibold sm:text-3xl">
            专业申请季,要的就是确定感
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/60">
            Compass 把最容易出错、最耗时间、最需要判断的环节做成清晰流程,让你少返工、少错过、少被信息差牵着走。
          </p>

          <ul className="mt-9 grid gap-4 sm:grid-cols-3">
            {[
              {
                t: '定位更有把握',
                d: '用公开要求和历史数据做参考,把冲刺、匹配、保底拆清楚,让每一次投递都有理由。',
              },
              {
                t: '材料不重复劳动',
                d: '成绩单、护照这类共用材料只维护一次,系统会告诉你它们分别覆盖哪几所学校。',
              },
              {
                t: '进度全程可控',
                d: '账号、材料、截止日和提交状态都在同一个看板里,关键节点提前提醒,申请节奏不掉线。',
              },
            ].map((x) => (
              <li key={x.t} className="border-t border-white/15 pt-5">
                <h3 className="font-medium">{x.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/60">{x.d}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── 常见问题 ───────────────────────────────── */}
      <section className="border-t border-white/70 bg-white">
        <div className="mx-auto max-w-3xl px-5 py-16 sm:py-24">
          <p className="gradient-text text-sm font-semibold">FAQ</p>
          <h2 className="display-heading mt-2 text-2xl font-semibold text-ink-900 sm:text-3xl">
            你可能想问
          </h2>

          <div className="mt-10 divide-y divide-ink-100 border-y border-ink-100">
            {FAQS.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex min-h-11 items-center justify-between gap-4 text-left">
                  <span className="font-medium text-ink-900">{f.q}</span>
                  <span aria-hidden className="shrink-0 text-xl leading-none text-ink-400">
                    <span className="group-open:hidden">+</span>
                    <span className="hidden group-open:inline">−</span>
                  </span>
                </summary>
                <p className="mt-3 pr-8 text-sm leading-relaxed text-ink-600">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── 收尾 CTA ───────────────────────────────── */}
      <section className="cta-band border-t border-white/70">
        <div className="mx-auto max-w-6xl px-5 py-20 text-center sm:py-28">
          <h2 className="display-heading text-3xl font-semibold text-ink-900 sm:text-4xl">
            先看看你能申哪些学校
          </h2>
          <p className="mx-auto mt-4 max-w-md text-ink-600">
            不用注册,不用付钱,一分钟就有结果。
            {entryPrice ? `觉得有用,再考虑要不要花 ${formatCents(entryPrice)}。` : ''}
          </p>
          <Link
            href="/assess"
            className="insta-button mt-8 inline-block rounded-full px-8 py-4 text-base font-medium text-white"
          >
            免费测一测
          </Link>
        </div>
      </section>

      {/* ── 页脚 ───────────────────────────────────── */}
      <footer className="border-t border-white/70 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-10">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <BrandLogo href="" />
              <p className="mt-2 max-w-md text-xs leading-relaxed text-ink-400">
                Compass 提供留学信息服务与申请管理工具,不做学科培训,不代理申请,
                不承诺录取结果。
              </p>
            </div>
            <nav className="flex flex-wrap items-center gap-x-1 text-xs text-ink-400">
              <Link href="/pricing" className="inline-flex min-h-11 items-center px-2 hover:text-ink-700">
                价格
              </Link>
              <Link href="/legal/terms" className="inline-flex min-h-11 items-center px-2 hover:text-ink-700">
                用户协议
              </Link>
              <Link href="/legal/privacy" className="inline-flex min-h-11 items-center px-2 hover:text-ink-700">
                隐私政策
              </Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  )
}
