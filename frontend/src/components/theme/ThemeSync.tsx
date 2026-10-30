import { useEffect } from 'react'

import { useTheme } from '@/components/theme/use-theme'
import { useMe } from '@/features/auth/api'

/**
 * The account's saved theme (from the database) wins over this browser's cached copy, so a
 * choice made on another device applies here after sign-in. Renders nothing.
 */
export function ThemeSync() {
  const { data: user } = useMe()
  const { setTheme } = useTheme()
  const savedTheme = user?.theme

  useEffect(() => {
    if (savedTheme) setTheme(savedTheme)
  }, [savedTheme, setTheme])

  return null
}
