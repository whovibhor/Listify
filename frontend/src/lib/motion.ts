import type { Transition } from 'motion/react'

/** Mirrors --duration-* and --ease-standard in index.css so CSS and Motion animations agree. */
export const duration = { fast: 0.12, base: 0.2, slow: 0.32 } as const

export const easeStandard = [0.2, 0, 0, 1] as const

export const transitions = {
  base: { duration: duration.base, ease: easeStandard },
  fast: { duration: duration.fast, ease: easeStandard },
} satisfies Record<string, Transition>

/** Subtle page-level enter animation; MotionConfig reducedMotion="user" disables transforms. */
export const pageEnter = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: transitions.base,
}
