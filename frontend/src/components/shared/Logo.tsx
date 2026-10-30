import { cn } from '@/lib/utils'

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-7 shrink-0', className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      {/* A tiny checklist: two ticked items. */}
      <path
        d="M7 11l2 2 3.5-4M16.5 11H25M7 21l2 2 3.5-4M16.5 21H25"
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-primary-foreground"
      />
    </svg>
  )
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <LogoMark />
      <span className="text-base font-semibold tracking-tight">Listify</span>
    </span>
  )
}
