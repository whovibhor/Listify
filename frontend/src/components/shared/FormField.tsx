import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'

import { Label } from '@/components/ui/label'
import { transitions } from '@/lib/motion'
import { cn } from '@/lib/utils'

interface FormFieldProps {
  label: ReactNode
  error?: string
  hint?: ReactNode
  /** Right-aligned element on the label row, e.g. a "Forgot password?" link. */
  labelAside?: ReactNode
  className?: string
  /** A single input-like element; it receives id, aria-invalid and aria-describedby. */
  children: ReactElement<Record<string, unknown>>
}

/** Label + control + hint + animated error, wired for screen readers. */
export function FormField({ label, error, hint, labelAside, className, children }: FormFieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })
    : children

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {labelAside}
      </div>
      {control}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <AnimatePresence initial={false}>
        {error ? (
          <motion.p
            key="error"
            id={errorId}
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={transitions.fast}
            className="text-sm text-destructive"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
