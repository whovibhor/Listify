import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

export function MemberAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <Avatar className={cn('size-10', className)}>
      <AvatarFallback className="bg-secondary text-sm font-semibold text-secondary-foreground">
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  )
}
