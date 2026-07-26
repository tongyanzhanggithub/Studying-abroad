/**
 * 自检脚本的破坏性操作护栏。
 *
 * ⚠️ 为什么必须有:verify-settlement.ts 里有
 *      db.user.deleteMany({ where: { phone: { startsWith: '1390009' } } })
 *    而 139-0009-xxxx 是**真实存在的号段**。跑错库就是删真实用户及其全部服务订单,
 *    级联删除,不可恢复。
 *
 * ⚠️ 这里踩过一次:最初的实现是**黑名单**(NODE_ENV=production,或 DATABASE_URL
 *    命中 rds.aliyuncs.com / prod 之类)。但本项目的生产部署恰恰两条都不命中 ——
 *    deploy/setup-db.sh 把 Postgres 装在同一台 ECS 上,写进 .env 的是
 *      postgresql://compass:***@localhost:5432/compass
 *    而 `npx tsx scripts/...` 这种跑法 NODE_ENV 是 undefined。
 *    于是护栏对**真正需要防的那个场景**完全失效 —— 一个防不住实际部署形态的护栏,
 *    比没有护栏更糟,因为它给人安全感。
 *
 * 所以改成**默认拒绝**:必须显式声明「我知道这会删数据,这个库是可以被删的」。
 * 代价是本地开发每次多一个环境变量,收益是不可能误删生产库。这个交换是划算的。
 */

const OPT_IN = 'ALLOW_DESTRUCTIVE_SELFTEST'

export function assertNotProduction(scriptName: string): void {
  if (process.env[OPT_IN] === 'true') return

  const url = process.env.DATABASE_URL ?? '(未设置)'
  // 只显示主机与库名,不打印密码
  const safeUrl = url.replace(/\/\/[^@]*@/, '//***@')

  console.error(
    `\n❌ 拒绝运行 ${scriptName}\n\n` +
      `   这个脚本会 **删除数据**(测试用户、服务订单、地区配置等)。\n` +
      `   当前数据库:${safeUrl}\n\n` +
      `   确认这是本地/测试库、可以被删之后,显式声明再跑:\n\n` +
      `     ${OPT_IN}=true npx tsx --tsconfig scripts/tsconfig.json ${scriptName}\n\n` +
      `   ⚠️ 绝不要在生产库上设这个变量。生产库里 139-0009 开头的手机号是真实用户。\n`,
  )
  process.exit(1)
}
