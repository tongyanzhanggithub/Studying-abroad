/**
 * 一条命令起本地环境:数据库 + 开发服务器。
 *
 *   npm start
 *
 * ── 为什么需要这个 ──────────────────────────────────────
 * PGlite 是嵌入式引擎,**每个服务进程只接受一次客户端连接**。
 * 所以必须先起数据库、等它就绪、再起 dev server,顺序错了就连不上;
 * 而且要占两个终端窗口。这个脚本把这些都包掉,Ctrl+C 一起停。
 *
 * 换成真实 Postgres 之后这个脚本就没必要了,直接 npm run dev。
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createConnection } from 'node:net'

const DB_PORT = 5433
const isWindows = process.platform === 'win32'

function log(msg: string) {
  console.log(`\x1b[36m[compass]\x1b[0m ${msg}`)
}

/** 端口是不是已经能连上了 */
function probe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host: '127.0.0.1' })
    const done = (ok: boolean) => {
      sock.destroy()
      resolve(ok)
    }
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
    setTimeout(() => done(false), 1000)
  })
}

async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probe(port)) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

const children: ChildProcess[] = []

function run(cmd: string, args: string[], name: string): ChildProcess {
  /**
   * Windows 上 npm/npx 是 .cmd,必须走 shell 才能起(否则 ENOENT)。
   * 但「shell:true + 单独传 args」会触发 Node 的 DEP0190 弃用警告
   * (它担心 args 不转义有注入风险)—— 这里 cmd/args 全是写死的、可信的,
   * 所以把它们拼成一整条命令字符串、不再单独传 args,就不会触发那个警告,
   * 也就不会在 Next 开发工具条里显示成一条 issue。
   * 非 Windows 保持 args 数组 + 不走 shell(更安全)。
   */
  const child = isWindows
    ? spawn([cmd, ...args].join(' '), { stdio: 'inherit', shell: true })
    : spawn(cmd, args, { stdio: 'inherit', shell: false })
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) log(`${name} 退出,code=${code}`)
    shutdown()
  })
  children.push(child)
  return child
}

let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  for (const c of children) {
    if (!c.killed) c.kill()
  }
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

async function main() {
  const already = await probe(DB_PORT)

  if (already) {
    log(`检测到 ${DB_PORT} 端口已有数据库在跑,直接复用。`)
  } else {
    log('启动本地数据库(PGlite)…')
    run('npx', ['tsx', 'scripts/db-local.ts'], 'db')

    const ok = await waitForPort(DB_PORT, 30_000)
    if (!ok) {
      log('数据库 30 秒内没起来。看上面的报错;常见原因是上一次没退干净。')
      log('Windows 上可以先跑:taskkill /F /IM node.exe')
      shutdown()
      return
    }
    log('数据库就绪。')
  }

  log('启动开发服务器…')
  run('npx', ['next', 'dev'], 'dev')

  log('')
  log('浏览器打开 http://localhost:3000')
  log('Ctrl+C 一起停掉。')
  log('')
  log('⚠️ 这个数据库同一时刻只能有一个连接,所以 dev server 跑着的时候')
  log('   db:seed / data:import / admin:create 这些脚本会连不上 ——')
  log('   要跑它们请先 Ctrl+C 停掉这里。')
}

main()
