/**
 * Next.js 启动钩子 —— 整个进程只跑一次。
 *
 * ⚠️ `assertProductionConfig()` 之前只是定义了,**从来没有被调用过**。
 *    一个「防止带着 mock 配置上线」的自检,不接进启动流程就是死代码,
 *    而且比没写更糟 —— 读代码的人会以为这层保护存在。
 */
export async function register() {
  // 只在 Node 运行时执行;Edge runtime 里没有这些环境变量
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { assertProductionConfig } = await import('@/lib/env')
  try {
    assertProductionConfig()
  } catch (err) {
    /**
     * ⚠️ 必须**主动退出进程**,不能让这个错误就这么抛出去。
     *
     * env.ts 里那句「宁可服务起不来(你立刻会发现)」描述的是意图,不是实际行为:
     * 光抛错的话 Next 会照常监听端口,只是让**每个请求**都变成 500。于是
     *   - systemctl status  → active (running),看着一切正常
     *   - nginx             → 不是 502 而是 500,像是应用内部的业务错误
     *   - 页面              → 一句 Internal Server Error,不含任何线索
     * 真正的原因只在 journalctl 里,而没人会在「服务显示正常」时去翻它。
     * 2026-08 那次就是这样:CRON_SECRET 缺失,整站 500,查了很久才定位。
     *
     * 退出后 systemd(Restart=always + StartLimitBurst=5)会重试几次然后停在
     * failed 状态 —— 这才是「起不来」该有的样子:status 一眼看到失败,
     * 日志里就是原因,nginx 502 也明确指向「后端没起来」。
     */
    console.error('\n' + (err instanceof Error ? err.message : String(err)) + '\n')
    process.exit(1)
  }
}
