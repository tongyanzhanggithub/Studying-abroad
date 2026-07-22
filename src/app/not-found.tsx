import Link from 'next/link'
import { Button, Card } from '@/components/ui'
import { BrandLogo } from '@/components/BrandLogo'

/** 404。不放技术措辞,直接给回去的路。 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <BrandLogo className="mb-6 text-lg" />
      <Card>
        <h1 className="text-xl font-semibold text-ink-900">这个页面不存在</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          可能是链接过期了,或者地址输错了。
        </p>
        <div className="mt-5 flex gap-2">
          <Link href="/" className="flex-1">
            <Button variant="secondary" className="w-full">
              回首页
            </Button>
          </Link>
          <Link href="/app/dashboard" className="flex-1">
            <Button className="w-full">回总览</Button>
          </Link>
        </div>
      </Card>
    </main>
  )
}
