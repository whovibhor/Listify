import { motion, useReducedMotion } from 'motion/react'

interface ProgressRingProps {
  done: number
  total: number
  size?: number
}

/** Today's completion as a ring with the numbers spelled out in the middle. */
export function ProgressRing({ done, total, size = 96 }: ProgressRingProps) {
  const reduceMotion = useReducedMotion()
  const stroke = 8
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const ratio = total === 0 ? 0 : done / total
  const percent = Math.round(ratio * 100)

  return (
    <div
      role="progressbar"
      aria-label="Today's progress"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={total === 0 ? 'Nothing planned for today' : `${done} of ${total} done`}
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-primary/15"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className="stroke-primary"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - ratio) }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.6, ease: [0.2, 0, 0, 1] }}
        />
      </svg>
      <span className="absolute text-center leading-tight" aria-hidden>
        <span className="block text-xl font-semibold">{total === 0 ? '—' : `${percent}%`}</span>
        <span className="block text-[0.65rem] text-muted-foreground">
          {done}/{total} done
        </span>
      </span>
    </div>
  )
}
