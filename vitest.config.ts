import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * 单元测试配置。
 *
 * 只测**纯函数** —— 不连数据库、不起 Next runtime。需要 DB 的集成验证仍走
 * scripts/verify-*.ts 与 /api/dev/verify-*(它们有生产护栏,见 guard-not-production.ts)。
 *
 * 两个要点:
 *  · `server-only` 在 Node 下 import 必抛,这里复用 scripts/ 已有的空实现;
 *    Next 构建仍走真包,该防护不受影响。
 *  · 固定 TZ:结算月份、到期日、倒计时都对时区敏感,不固定会出现
 *    「本机绿、CI 红」。阿里云 ECS 默认 UTC,本机多为 CST。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: { TZ: 'Asia/Shanghai' },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./scripts/stubs/server-only.ts', import.meta.url)),
    },
  },
})
