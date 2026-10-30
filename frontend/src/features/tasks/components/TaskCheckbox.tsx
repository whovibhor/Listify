import { CheckIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'

import { transitions } from '@/lib/motion'
import { cn } from '@/lib/utils'

interface TaskCheckboxProps {
  checked: boolean
  onToggle: () => void
  label: string
  disabled?: boolean
  size?: 'sm' | 'md'
}

/** Round completion toggle with a quick check-draw animation (reduced-motion aware via MotionConfig). */
export function TaskCheckbox({
  checked,
  onToggle,
  label,
  disabled,
  size = 'md',
}: TaskCheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      className={cn(
        'group/check relative grid shrink-0 place-items-center rounded-full border-2 transition-colors duration-(--duration-fast) outline-none',
        'focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'md' ? 'size-5' : 'size-4',
        checked
          ? 'border-status-completed bg-status-completed text-primary-foreground'
          : 'border-muted-foreground/40 hover:border-status-completed hover:bg-status-completed/10',
      )}
    >
      <AnimatePresence initial={false}>
        {checked ? (
          <motion.span
            key="check"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={transitions.fast}
          >
            <CheckIcon className={size === 'md' ? 'size-3' : 'size-2.5'} strokeWidth={3.5} />
          </motion.span>
        ) : (
          <CheckIcon
            aria-hidden
            className={cn(
              'text-status-completed opacity-0 transition-opacity group-hover/check:opacity-60',
              size === 'md' ? 'size-3' : 'size-2.5',
            )}
            strokeWidth={3.5}
          />
        )}
      </AnimatePresence>
    </button>
  )
}
