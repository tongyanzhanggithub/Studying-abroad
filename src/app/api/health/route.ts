import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * 健康检查。
 *
 * systemd 只能发现「进程挂了」,发现不了「进程活着但数据库连不上」——
 * 后者用户看到的是满屏报错,而服务器上一切正常,没有任何人会知道。
 *
 * 这个接口真的去查一次库,不是只返回 200。
 * 用 count 而不是 `SELECT 1`:后者连上就算过,而 Prisma 客户端与
 * 实际表结构不一致时(比如 migrate 没跑完)也照样是通的。
 *
 * 不返回任何业务数据 —— 公网可访问,不能变成信息泄露点。
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await db.program.count()
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    console.error('[health] 数据库不可用', err)
    // 500 而不是 200,监控 / 负载均衡才抓得到
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
