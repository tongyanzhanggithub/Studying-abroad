import { NextResponse, type NextRequest } from 'next/server'

/**
 * 把当前路径注入请求头,供 Server Component(如 admin layout)判断是否为登录页。
 * Next.js 不默认提供这个信息,而 layout 里拿不到 pathname。
 */
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers)
  headers.set('x-pathname', request.nextUrl.pathname)
  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: [
    // 跳过静态资源与图片优化
    '/((?!_next/static|_next/image|favicon.ico|uploads).*)',
  ],
}
