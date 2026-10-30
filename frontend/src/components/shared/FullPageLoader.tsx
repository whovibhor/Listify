import { LogoMark } from '@/components/shared/Logo'

export function FullPageLoader({ label = 'Loading WorkPulse…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="grid min-h-svh place-items-center bg-background"
    >
      <div className="flex flex-col items-center gap-3">
        <LogoMark className="size-10 animate-pulse" />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
    </div>
  )
}
