import { XIcon } from 'lucide-react'

import { TAG_COLOR_CLASSES } from '@/features/tasks/tag-colors'
import type { Tag } from '@/features/tasks/types'
import { cn } from '@/lib/utils'

interface TagChipProps {
  tag: Tag
  onRemove?: () => void
  className?: string
}

export function TagChip({ tag, onRemove, className }: TagChipProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-40 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium',
        TAG_COLOR_CLASSES[tag.color].chip,
        className,
      )}
    >
      <span className="truncate">{tag.name}</span>
      {onRemove ? (
        // 24px hit area (WCAG 2.5.8) around a small icon, pulled into the chip's padding.
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove tag ${tag.name}`}
          className="-my-1 -mr-1.5 grid size-6 place-items-center rounded-md opacity-70 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <XIcon className="size-3" />
        </button>
      ) : null}
    </span>
  )
}
