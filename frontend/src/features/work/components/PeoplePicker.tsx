import { useState } from 'react'
import { CheckIcon, UserPlusIcon, type LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface PersonOption {
  user_id: number
  name: string
}

interface PeoplePickerProps {
  label: string
  people: PersonOption[]
  selected: number[]
  onToggle: (userId: number) => void
  disabled?: boolean
  icon?: LucideIcon
}

/** Searchable checklist of people. The chips showing who's chosen belong to the caller. */
export function PeoplePicker({
  label,
  people,
  selected,
  onToggle,
  disabled,
  icon: Icon = UserPlusIcon,
}: PeoplePickerProps) {
  const [search, setSearch] = useState('')
  const term = search.trim().toLowerCase()
  const visible = people.filter((person) => person.name.toLowerCase().includes(term))

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          <Icon data-icon="inline-start" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-2 p-2">
        <Input
          type="search"
          aria-label="Search people"
          placeholder="Search people"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <ul className="max-h-56 space-y-0.5 overflow-y-auto">
          {visible.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">Nobody found.</li>
          ) : null}
          {visible.map((person) => {
            const chosen = selected.includes(person.user_id)
            return (
              <li key={person.user_id}>
                <button
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => onToggle(person.user_id)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50',
                    chosen && 'font-medium',
                  )}
                >
                  <span className="min-w-0 truncate">{person.name}</span>
                  {chosen ? <CheckIcon aria-hidden className="size-4 shrink-0" /> : null}
                </button>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
