import 'server-only'
import { checkLlmRegion } from '@/lib/llm/region-guard'

/**
 * 集中读取环境变量。缺失的可选配置一律降级到 mock,保证开发环境
 * 在没有微信商户号 / 短信资质 / LLM key 的情况下依然能跑通全链路。
 */

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback
  if (!v) throw new Error(`缺少必需的环境变量 ${name},请检查 .env`)
  return v
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  authSecret: required('AUTH_SECRET'),
  /**
   * 定时任务接口的调用密钥。
   *
   * 独立于 AUTH_SECRET —— 因为它会被明文写进 /etc/cron.d/compass 和
   * curl 命令里,泄露面比 AUTH_SECRET 大得多。而 AUTH_SECRET 是签会话用的:
   * 两者一旦共用,cron 密钥泄露 = 能伪造任意用户登录态。
   * 没单独配就退回 AUTH_SECRET,保证老部署不会因此突然 401。
   */
  cronSecret: process.env.CRON_SECRET || required('AUTH_SECRET'),
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  isProd: process.env.NODE_ENV === 'production',

  llm: {
    provider: (process.env.LLM_PROVIDER ?? 'mock') as
      | 'anthropic'
      | 'openai_compatible'
      | 'mock',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
    openaiBaseUrl: process.env.OPENAI_COMPAT_BASE_URL ?? '',
    openaiApiKey: process.env.OPENAI_COMPAT_API_KEY ?? '',
    openaiModel: process.env.OPENAI_COMPAT_MODEL ?? '',
  },

  payment: {
    provider: (process.env.PAYMENT_PROVIDER ?? 'mock') as 'mock' | 'wechat',
    /**
     * 演示环境逃生门:允许生产环境在没接微信支付时也能「点击即支付成功」。
     *
     * ⚠️ 和 ALLOW_MOCK_SMS 同理,默认关闭。不打开时,mock 支付确认接口在生产
     *    环境**直接拒绝** —— 否则任何人拿到自己订单的 outTradeNo 访问 /pay/mock
     *    点一下,就能把订单标成已支付、白拿季票(零元购)。演示部署要走通付款流程
     *    时才显式设 ALLOW_MOCK_PAYMENT=true。
     * ⚠️ 接入真实微信支付后必须删掉这个变量。
     */
    allowMockInProd: process.env.ALLOW_MOCK_PAYMENT === 'true',
    wechat: {
      mchId: process.env.WECHAT_MCH_ID ?? '',
      appId: process.env.WECHAT_APP_ID ?? '',
      apiV3Key: process.env.WECHAT_API_V3_KEY ?? '',
      certSerial: process.env.WECHAT_CERT_SERIAL ?? '',
      privateKeyPath: process.env.WECHAT_PRIVATE_KEY_PATH ?? '',
      notifyUrl: process.env.WECHAT_NOTIFY_URL ?? '',
    },
  },

  sms: {
    provider: (process.env.SMS_PROVIDER ?? 'mock') as 'mock' | 'aliyun',
    /**
     * 演示环境逃生门:允许生产环境在没接短信时也能登录。
     *
     * ⚠️ 打开后验证码**只写进服务端日志**,绝不随响应返回 ——
     *    登录要能读到服务器日志(即有 SSH)。如果把码显示在页面上,
     *    等于任何人都能登任意手机号,那是彻底的认证绕过。
     * ⚠️ 接入真实短信后必须删掉这个变量。它存在的唯一理由是
     *    「资质还没下来,但要先把线上功能走通」。
     */
    allowMockInProd: process.env.ALLOW_MOCK_SMS === 'true',
  },

  storage: {
    provider: (process.env.STORAGE_PROVIDER ?? 'local') as 'local' | 'oss',
    oss: {
      region: process.env.OSS_REGION ?? '',
      bucket: process.env.OSS_BUCKET ?? '',
      // ⚠️ 用 RAM 子账号的 key,只授这一个 bucket 的读写,不要用主账号 AccessKey
      accessKeyId: process.env.OSS_ACCESS_KEY_ID ?? '',
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET ?? '',
      // 走内网 endpoint 时置 true —— ECS 与 OSS 同区域可免公网流量费且更安全
      internal: process.env.OSS_INTERNAL === 'true',
    },
  },
}

/**
 * 生产环境启动自检。
 *
 * ⚠️ 区分两类问题,处理方式完全不同:
 *
 *   **致命** —— 直接拒绝启动。这类配置错误会造成安全事故,
 *     宁可服务起不来(你立刻会发现)也不能带着它跑
 *     (带着跑的话没人会发现,直到出事)。
 *
 *   **未接入** —— 大声告警但放行。支付/短信/LLM 用 mock 是
 *     演示环境的正常状态,一律拒绝启动会让「先部署跑通、
 *     资质下来再接」这条完全合理的路径走不通。
 *
 * 早先这个函数把两类混在一起,而且**从来没有被调用过** —— 是死代码。
 */
export function assertProductionConfig() {
  if (!env.isProd) return

  const fatal: string[] = []
  if (env.authSecret.startsWith('dev-only')) {
    // 会话是用它签的 —— 默认值等于任何人都能伪造任意用户的登录态
    fatal.push('AUTH_SECRET 仍是开发默认值,任何人都能伪造登录态')
  }
  if (env.authSecret.length < 32) {
    // 只拦 dev-only 前缀不够:短而弱的密钥(如 secret123)也能通过。
    // HS256 短密钥可离线爆破,爆破成功即可伪造任意会话。要求 ≥32 字符
    // (openssl rand -base64 32 正好满足)。
    fatal.push('AUTH_SECRET 太短(需 ≥32 字符),易被离线爆破;用 openssl rand -base64 32 重新生成')
  }
  if (!process.env.CRON_SECRET) {
    // cronSecret 缺省会回退到 AUTH_SECRET,注释里说明了危害(cron 密钥泄露=能伪造登录态)。
    // 生产环境这个「独立」不能名存实亡 —— 缺失即致命,逼你单独生成一个。
    fatal.push('CRON_SECRET 未配置(生产不允许回退到 AUTH_SECRET);用 openssl rand -base64 32 单独生成')
  }
  if (env.siteUrl.includes('localhost')) {
    fatal.push('NEXT_PUBLIC_SITE_URL 仍是 localhost,分享链接会全部失效')
  }

  /**
   * 数据出境是合规红线,不能靠「记得选国内模型」。
   *
   * ⚠️ 这里只覆盖 .env。后台设置页可以把 key 存进数据库覆盖 .env,
   *    所以 getLlmProvider() 里还有一道运行时校验 —— 两道都要。
   */
  const region = checkLlmRegion(env.llm.provider, env.llm.openaiBaseUrl)
  if (!region.ok) fatal.push(region.reason)
  if (fatal.length) {
    throw new Error(`❌ 生产环境配置有致命问题,拒绝启动:\n- ${fatal.join('\n- ')}`)
  }

  const missing: string[] = []
  if (!env.siteUrl.startsWith('https://')) {
    /**
     * 不设为致命 —— 「只有 IP、还没域名和证书」的演示阶段是正常过渡态,
     * 一律拒绝启动会把这条合理路径堵死。但必须说清代价:
     * 此时会话 cookie 不带 Secure(带了浏览器会丢弃,导致根本登录不上),
     * 也就是说 cookie 在网络上是明文传输的,可被同网络的人截获。
     */
    missing.push(
      '站点跑在 HTTP 上(没有 HTTPS)—— 会话 cookie 明文传输,可被截获;' +
        '绑域名后执行 certbot --nginx 并把 NEXT_PUBLIC_SITE_URL 改成 https://',
    )
  }
  if (env.sms.provider === 'mock') {
    missing.push(
      env.sms.allowMockInProd
        ? '短信未接入,但 ALLOW_MOCK_SMS=true(演示模式)—— 验证码只打在本日志里,接入真实短信后务必删掉这个开关'
        : '短信未接入 —— 用户收不到验证码,无法注册登录',
    )
  }
  if (env.payment.provider === 'mock') {
    missing.push(
      env.payment.allowMockInProd
        ? '支付未接入,但 ALLOW_MOCK_PAYMENT=true(演示模式)—— 任何人点一下就能白拿季票,只应在无真实用户的演示环境开启,接入真实支付后务必删掉这个开关'
        : '支付未接入 —— 收不了款,也退不了款(mock 确认接口在生产环境已被拒绝)',
    )
  }
  if (env.llm.provider === 'mock') missing.push('LLM 未配置 —— AI 采集与文书功能不可用')
  if (env.storage.provider === 'local') {
    missing.push('对象存储未接入 —— 学生材料明文存本机磁盘,且随机器一起丢')
  }
  if (missing.length) {
    console.warn(
      `\n⚠️  以下能力尚未接入,当前只能作为演示环境使用:\n- ${missing.join('\n- ')}\n`,
    )
  }
}
