/**
 * 本地 Postgres(免 Docker)—— 应急方案,非日常开发用
 *
 *   npm run db:start   启动(前台常驻,Ctrl+C 停止)
 *
 * ⚠️ 已知限制:PGlite 是单用户嵌入式引擎,**每个服务进程只接受一次客户端连接**。
 *    跑完一条命令(db:push / db:seed / data:import)就要重启一次;
 *    dev server 连上之后,其它脚本完全连不上。
 *    日常开发请用真实 Postgres(见 README「数据库」一节)。
 *
 * 用 PGlite —— Postgres 的 WASM 构建 —— 通过 socket 服务器暴露标准
 * Postgres 线协议。Prisma / psql / 任何 pg 客户端都能照常连接,
 * DATABASE_URL 不用改,schema 里的 enum / String[] / Json 全部原样可用。
 *
 * 为什么不用 Docker 或 embedded-postgres:
 *   · Docker Desktop 需要单独启动,增加一层依赖
 *   · embedded-postgres 在中文 Windows 上 initdb 会失败 —— PG 18 初始化时
 *     枚举系统区域名,中文 locale 名在 GBK 下是非法 UTF8 字节序列
 *     (invalid byte sequence for encoding "UTF8": 0xce 0xc4)。
 *   PGlite 不碰操作系统区域设置,绕开了整类问题。
 *
 * ⚠️ 仅供本地开发。生产按 PRD 7.1 部署到国内云的托管 Postgres。
 */

import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { homedir } from 'node:os'
import { join } from 'node:path'

// 数据目录放在纯 ASCII 路径下 —— 项目路径含中文,部分工具链会出问题
const DATA_DIR = join(homedir(), 'AppData', 'Local', 'compass-pgdata')
const PORT = 5433

async function main() {
  console.log('正在启动本地 Postgres(PGlite)…')

  const pglite = await PGlite.create({ dataDir: DATA_DIR })

  const server = new PGLiteSocketServer({
    db: pglite,
    port: PORT,
    host: '127.0.0.1',
  })

  await server.start()

  console.log(`✓ Postgres 已就绪 127.0.0.1:${PORT}`)
  console.log(`  数据目录 ${DATA_DIR}`)
  console.log('')
  console.log('DATABASE_URL 已在 .env 中配置好,可直接运行:')
  console.log('  npm run db:push     建表')
  console.log('  npm run db:seed     写入种子数据')
  console.log('  npm run data:import 导入院校数据')
  console.log('')
  console.log('保持此窗口开启。Ctrl+C 停止。')

  const shutdown = async () => {
    console.log('\n正在停止…')
    await server.stop()
    await pglite.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await new Promise(() => {})
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
