import { useMemo, useState } from 'react'
import { CheckIcon, PlusIcon, TagIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useCreateTag, useTags } from '@/features/tasks/api'
import { TAG_COLOR_CLASSES } from '@/features/tasks/tag-colors'
import { TAG_COLORS, type Tag } from '@/features/tasks/types'
import { cn } from '@/lib/utils'

const MAX_TAGS = 10

interface TagPickerProps {
  selected: Tag[]
  onChange: (tagIds: number[]) => void
  disabled?: boolean
  /** Organization tasks use that organization's tags, never personal ones. */
  organizationId?: number | null
}

export function TagPicker({ selected, onChange, disabled, organizationId }: TagPickerProps) {
  const { data: tags = [] } = useTags(organizationId)
  const createTag = useCreateTag(organizationId)
  const [search, setSearch] = useState('')
  const selectedIds = selected.map((tag) => tag.id)
  const term = search.trim()

  const visible = useMemo(
    () => tags.filter((tag) => tag.name.toLowerCase().includes(term.toLowerCase())),
    [tags, term],
  )
  const exactMatch = tags.some((tag) => tag.name.toLowerCase() === term.toLowerCase())

  const toggle = (id: number) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((tagId) => tagId !== id))
    else if (selectedIds.length >= MAX_TAGS)
      toast.error(`A task can have at most ${MAX_TAGS} tags.`)
    else onChange([...selectedIds, id])
  }

  const create = () => {
    const color = TAG_COLORS[(tags.length + 1) % TAG_COLORS.length]
    createTag.mutate(
      { name: term, color },
      {
        onSuccess: (tag) => {
          setSearch('')
          if (selectedIds.length < MAX_TAGS) onChange([...selectedIds, tag.id])
        },
        onError: (error) => toast.error(error.message),
      },
    )
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <TagIcon data-icon="inline-start" />
          {selected.length ? 'Edit tags' : 'Add tags'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && term && !exactMatch) {
              event.preventDefault()
              create()
            }
          }}
          placeholder="Find or create a tag"
          aria-label="Find or create a tag"
          maxLength={40}
          autoFocus
        />
        <ul
          className="mt-2 max-h-56 space-y-0.5 overflow-y-auto"
          role="listbox"
          aria-multiselectable
        >
          {visible.map((tag) => {
            const isSelected = selectedIds.includes(tag.id)
            return (
              <li key={tag.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => toggle(tag.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                >
                  <span
                    aria-hidden
                    className={cn('size-2.5 rounded-full', TAG_COLOR_CLASSES[tag.color].dot)}
                  />
                  <span className="flex-1 truncate">{tag.name}</span>
                  {isSelected ? <CheckIcon aria-hidden className="size-4 text-primary" /> : null}
                </button>
              </li>
            )
          })}
          {term && !exactMatch ? (
            <li>
              <button
                type="button"
                onClick={create}
                disabled={createTag.isPending}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-primary outline-none hover:bg-accent focus-visible:bg-accent"
              >
                <PlusIcon aria-hidden className="size-4" />
                Create “{term}”
              </button>
            </li>
          ) : null}
          {!term && tags.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">
              Type a name to create your first tag.
            </li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
