/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ali-oss 是可选依赖(只有 STORAGE_PROVIDER=oss 才用),标为 external
  // 让打包器不去静态解析它 —— 没安装时 build 也不会失败
  serverExternalPackages: ['@prisma/client', 'ali-oss'],
  experimental: {
    // 文书内容与 AI 流式返回体积较大,放宽 Server Action body 限制
    serverActions: { bodySizeLimit: '4mb' },
  },

  /**
   * 安全响应头 —— 之前一个都没有。
   *
   * 最要命的是可被 iframe 嵌套:攻击者做一个页面把 /admin/login 或
   * 学生的材料页透明覆盖在自己的按钮上,用户以为在点别的东西,
   * 实际点的是我们的页面(点击劫持)。后台能改价格、能看学生护照,
   * 这个洞不能留。
   *
   * 这里**不设完整 CSP**:Next.js 的内联脚本需要 nonce 配合,
   * 配错了整站白屏,而白屏比缺一层纵深防御更糟。只取 frame-ancestors
   * 这一条 —— 它是防点击劫持的实际生效项,且不会误伤任何现有代码。
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // 现代浏览器认这条
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          // 老浏览器只认这条
          { key: 'X-Frame-Options', value: 'DENY' },
          // 禁止浏览器把 .txt 猜成 .html 执行 —— 学生上传的文件是从本站域名发出的
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // 跳去外部网站时不要带上完整 URL(评估结果页的 URL 里有参数)
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // 没有用到这些能力,一律关掉
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          /**
           * HSTS:浏览器只在 **https 响应**上采纳这条,http 下会忽略,
           * 所以现在(还没配证书)加上是安全的;certbot 配好域名的当天
           * 它自动开始生效,不用记得回来补。
           */
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ]
  },
}

export default nextConfig
