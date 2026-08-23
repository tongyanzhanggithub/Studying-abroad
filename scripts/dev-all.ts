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

import { spawn, execSync, type ChildProcess } from 'node:child_process'
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

/**
 * 端口占着 ≠ 数据库能用。
 *
 * ⚠️ 这里原来是「探测到 5433 通,就直接复用」。这句话害人:
 *
 *    PGlite 同一时刻**只接受一个客户端**。而 Windows 上没有干净停掉
 *    dev server 的办法(Stop-Process / taskkill 都是硬杀,SIGINT 送不进去),
 *    所以 dev 被杀之后,PGlite 那个连接名额**不会被释放** ——
 *    端口照样在监听,TCP 照样连得通,但任何新客户端都会被拒。
 *
 *    于是 probe() 返回 true,脚本高高兴兴地说「直接复用」,
 *    dev server 起来之后每一次查询都是
 *    「Can't reach database server at localhost:5433」。
 *    首页降级成兜底数据、工作台直接跳错误页,而日志最上面写着「复用」。
 *
 *    实测踩到两次,两次都花了十几分钟才反应过来问题在数据库不在页面。
 *
 * 所以改成:端口被占 = 那多半是上一次留下的、已经不可用的 PGlite,
 * **杀掉重来**。本地开发环境里这是安全的 —— 5433 是这个项目专用端口,
 * 而且 PGlite 的数据在磁盘上(DATA_DIR),重启不丢。
 *
 * (为什么不「真连一次验证」:验证本身就要占掉那唯一的名额,
 *  验证成功等于把名额用光,dev server 反而连不上了。)
 */
function killPortOwner(port: number): boolean {
  if (!isWindows) {
    // macOS / Linux 上有 lsof,而且那边能正常发 SIGINT,通常不会走到这里
    try {
      execSync(`lsof -ti tcp:${port} | xargs -r kill`, { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }
  try {
    const out = execSync(`netstat -ano -p tcp | findstr LISTENING | findstr :${port}`, {
      encoding: 'utf8',
    })
    const pids = [...new Set(out.trim().split(/\r?\n/).map((l) => l.trim().split(/\s+/).pop()))]
      .filter((x): x is string => !!x && /^\d+$/.test(x) && x !== '0')
    if (!pids.length) return false
    for (const pid of pids) execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

async function main() {
  if (await probe(DB_PORT)) {
    log(`${DB_PORT} 端口被占着 —— 多半是上次没退干净的 PGlite,它的连接名额已经用掉了。`)
    if (killPortOwner(DB_PORT)) {
      log('已停掉旧进程。')
      // 端口释放要一点时间,不等的话新进程会 EADDRINUSE
      for (let i = 0; i < 20 && (await probe(DB_PORT)); i++) {
        await new Promise((r) => setTimeout(r, 250))
      }
    } else {
      log('没能停掉它。请手动结束占用 5433 的进程后重来。')
      shutdown()
      return
    }
  }

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
