import type { TagColor } from '@/features/tasks/types'

// Full class names so Tailwind can see them. Text shades keep >= 4.5:1 on the tinted background.
export const TAG_COLOR_CLASSES: Record<TagColor, { chip: string; dot: string }> = {
  gray: { chip: 'bg-gray-500/12 text-gray-700 dark:text-gray-300', dot: 'bg-gray-500' },
  violet: { chip: 'bg-violet-500/12 text-violet-700 dark:text-violet-300', dot: 'bg-violet-500' },
  blue: { chip: 'bg-blue-500/12 text-blue-700 dark:text-blue-300', dot: 'bg-blue-500' },
  teal: { chip: 'bg-teal-500/12 text-teal-700 dark:text-teal-300', dot: 'bg-teal-500' },
  green: { chip: 'bg-green-500/12 text-green-700 dark:text-green-300', dot: 'bg-green-500' },
  amber: { chip: 'bg-amber-500/15 text-amber-800 dark:text-amber-300', dot: 'bg-amber-500' },
  orange: { chip: 'bg-orange-500/12 text-orange-700 dark:text-orange-300', dot: 'bg-orange-500' },
  red: { chip: 'bg-red-500/12 text-red-700 dark:text-red-300', dot: 'bg-red-500' },
  pink: { chip: 'bg-pink-500/12 text-pink-700 dark:text-pink-300', dot: 'bg-pink-500' },
}
