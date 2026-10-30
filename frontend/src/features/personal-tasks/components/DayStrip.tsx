import { format, isWeekend } from 'date-fns'

import { cn } from '@/lib/utils'

export interface StripDay {
  key: string // YYYY-MM-DD (local)
  date: Date
  count: number
}

interface DayStripProps {
  days: StripDay[]
  selected: string | null
  onSelect: (key: string) => void
}

/**
 * Scrollable 14-day strip: weekday, date and how many tasks are due. Snaps on touch devices;
 * a right-edge fade (mask) signals that it scrolls.
 */
export function DayStrip({ days, selected, onSelect }: DayStripProps) {
  return (
    <div
      role="listbox"
      aria-label="Choose a day"
      aria-orientation="horizontal"
      className="-mx-4 flex snap-x snap-mandatory [scrollbar-width:thin] gap-2 overflow-x-auto mask-r-from-90% px-4 pb-2 sm:mx-0 sm:px-0"
    >
      {days.map((day) => {
        const isSelected = day.key === selected
        return (
          <button
            key={day.key}
            type="button"
            role="option"
            aria-selected={isSelected}
            aria-label={`${format(day.date, 'EEEE d MMMM')}: ${day.count} task${day.count === 1 ? '' : 's'} due`}
            onClick={() => onSelect(day.key)}
            className={cn(
              'flex w-16 shrink-0 snap-start flex-col items-center gap-0.5 rounded-xl border px-2 py-2.5 outline-none',
              'transition-[background-color,border-color,box-shadow,transform] duration-(--duration-fast)',
              'focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]',
              isSelected
                ? 'border-primary bg-primary text-primary-foreground shadow-raised'
                : 'bg-card hover:border-primary/40 hover:shadow-card',
              !isSelected && isWeekend(day.date) && 'bg-muted/60',
            )}
          >
            <span
              className={cn(
                'text-[0.7rem] font-medium uppercase',
                !isSelected && 'text-muted-foreground',
              )}
            >
              {format(day.date, 'EEE')}
            </span>
            <span className="text-xl leading-none font-semibold">{format(day.date, 'd')}</span>
            <span
              className={cn(
                'mt-1 min-w-5 rounded-full px-1.5 text-center text-[0.7rem] font-medium tabular-nums',
                day.count === 0
                  ? isSelected
                    ? 'text-primary-foreground/70'
                    : 'text-muted-foreground/60'
                  : isSelected
                    ? 'bg-primary-foreground/20'
                    : 'bg-accent text-accent-foreground',
              )}
            >
              {day.count === 0 ? '–' : day.count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
