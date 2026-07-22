import Link from 'next/link'
import { cn } from '@/lib/utils'

export function BrandLogo({
  href = '/',
  className,
  markClassName,
}: {
  href?: string
  className?: string
  markClassName?: string
}) {
  const content = (
    <>
      <span className={cn('brand-mark', markClassName)} aria-hidden>
        <span className="brand-mark__needle" />
        <span className="brand-mark__route" />
      </span>
      <span className="brand-word">Compass</span>
    </>
  )

  if (!href) {
    return <span className={cn('brand-logo', className)}>{content}</span>
  }

  return (
    <Link href={href} className={cn('brand-logo', className)}>
      {content}
    </Link>
  )
}
