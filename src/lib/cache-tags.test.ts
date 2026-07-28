import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CACHE_TAGS, MARKETING_CACHE_SECONDS } from '@/lib/cache-tags'

/**
 * 首页那份数据现在有**跨请求缓存**,于是多了一种以前不存在的 bug:
 * 「后台改了,前台不变」—— 不报错、不崩页、没有任何日志,只能靠有人发现。
 *
 * 这类 bug 的成因永远是同一个:有人新加了一条改动 Plan / Program / RegionSetting
 * 的路径,而忘了让缓存失效。所以这里做一道静态检查:凡是会改这三张表的
 * server action 文件,必须出现 revalidateTag。
 *
 * ⚠️ 这是文本检查,不是行为检查 —— 它证明不了失效逻辑写对了,
 *    只能保证「压根没写」这件事不会静悄悄发生。真正的行为需要连库才能验,
 *    本地没有可用的 Postgres,这一层没有跑过。
 */

const SRC = join(process.cwd(), 'src')

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8')
}

/** 会改动首页缓存所依赖的数据、因而必须调 revalidateTag 的文件 */
const MUST_INVALIDATE = [
  // Plan(首页「起价」)与 ServiceSku
  'app/admin/pricing/actions.ts',
  // RegionSetting —— 开关地区会改变首页的院校/项目口径
  'app/admin/regions/actions.ts',
  // Program 增删改
  'app/admin/programs/new/actions.ts',
  'app/admin/programs/[id]/actions.ts',
  'app/admin/programs/io-actions.ts',
  // AI 采集草稿通过审核后会落成 Program
  'app/admin/collect/actions.ts',
]

describe('首页跨请求缓存的失效覆盖', () => {
  it.each(MUST_INVALIDATE)('%s 会让缓存失效', (rel) => {
    expect(read(rel)).toContain('revalidateTag')
  })

  it('首页确实声明了这两个标签,否则上面的失效调用是打在空气上', () => {
    const page = read('app/page.tsx')
    expect(page).toContain('unstable_cache')
    expect(page).toContain('CACHE_TAGS.publicCatalog')
    expect(page).toContain('CACHE_TAGS.plans')
  })

  it('标签名不重复 —— 两个标签同名会让失效范围悄悄扩大一倍', () => {
    const values = Object.values(CACHE_TAGS)
    expect(new Set(values).size).toBe(values.length)
  })

  /**
   * TTL 是命令行导入(跑在 Next 进程外,调不到 revalidateTag)之后的唯一兜底。
   * 调得太长,`npm run schools:import` 完首页会长时间停在旧数字;
   * 调成 0 等于没缓存,这次优化白做。
   */
  it('兜底 TTL 在合理区间(1 分钟 ~ 1 小时)', () => {
    expect(MARKETING_CACHE_SECONDS).toBeGreaterThanOrEqual(60)
    expect(MARKETING_CACHE_SECONDS).toBeLessThanOrEqual(3600)
  })
})

describe('定价页埋点不再写在渲染路径上', () => {
  /**
   * 原来是 `await track('pricing_view', ...)` 直接写在页面组件里 ——
   * Next 的预取/重渲会重复计数,而且给匿名流量制造 RDS 写放大。
   * 现在改由客户端挂载后回调。这条断言防止有人图省事又把它挪回服务端渲染里。
   */
  it('page.tsx 里没有 track() 调用', () => {
    const page = read('app/pricing/page.tsx')
    expect(page).not.toContain('track(')
  })

  it('改由客户端组件上报', () => {
    expect(read('app/pricing/page.tsx')).toContain('TrackPricingView')
    const view = read('app/pricing/TrackView.tsx')
    expect(view).toContain("'use client'")
    expect(view).toContain('useEffect')
    // ref 守卫:严格模式下 effect 会跑两遍,不挡就是每次记两条
    expect(view).toContain('useRef')
  })
})
