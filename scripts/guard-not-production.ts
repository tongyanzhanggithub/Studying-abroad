/**
 * 自检脚本的生产环境护栏。
 *
 * ⚠️ 为什么必须有这个:verify-settlement.ts 里有
 *      db.user.deleteMany({ where: { phone: { startsWith: '1390009' } } })
 *    而 139-0009-xxxx 是**真实存在的号段**。dev 自检路由有
 *    `NODE_ENV === 'production' → 404` 挡着,但脚本一条保护都没有 ——
 *    只要 .env 里的 DATABASE_URL 指向阿里云 RDS,跑一次自检就会删掉真实用户
 *    及其全部服务订单,且无法恢复。
 *
 * 每个会写库的自检脚本都必须在 main() 之前调用它。
 */

const PROD_DB_PATTERNS = [
  /rds\.aliyuncs\.com/i, // 阿里云 RDS
  /\.tencentcdb\.com/i, // 腾讯云
  /prod/i, // 库名/主机名里带 prod
  /neon\.tech|supabase\.co/i, // 常见云端库(可能是共享环境)
]

export function assertNotProduction(scriptName: string): void {
  const url = process.env.DATABASE_URL ?? ''

  const reasons: string[] = []
  if (process.env.NODE_ENV === 'production') reasons.push('NODE_ENV=production')
  const hit = PROD_DB_PATTERNS.find((p) => p.test(url))
  if (hit) reasons.push(`DATABASE_URL 命中生产库特征 ${hit}`)
  if (process.env.ALLOW_DESTRUCTIVE_SELFTEST === 'true') {
    // 明确的逃生门:确实要在某个非本地但安全的环境上跑时用
    console.warn(`⚠️ ALLOW_DESTRUCTIVE_SELFTEST=true,已跳过生产护栏(${scriptName})`)
    return
  }

  if (reasons.length) {
    console.error(
      `\n❌ 拒绝运行 ${scriptName} —— 它会删除数据,而当前环境疑似生产:\n` +
        reasons.map((r) => `   · ${r}`).join('\n') +
        `\n\n   自检脚本只应在本地/测试库上跑。确认无误要强制运行:\n` +
        `   ALLOW_DESTRUCTIVE_SELFTEST=true npx tsx ...\n`,
    )
    process.exit(1)
  }
}
