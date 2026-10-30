import {
  LaptopIcon,
  LogOutIcon,
  MoonIcon,
  ShieldCheckIcon,
  SunIcon,
  UserRoundIcon,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'

import type { Theme } from '@/components/theme/theme-context'
import { useTheme } from '@/components/theme/use-theme'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useLogout, useMe, useUpdatePreferences } from '@/features/auth/api'

const themeOptions = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: LaptopIcon },
] as const

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

export function UserMenu() {
  const { theme, setTheme } = useTheme()
  const { data: user } = useMe()
  const logout = useLogout()
  const savePreferences = useUpdatePreferences()
  const navigate = useNavigate()

  const chooseTheme = (next: Theme) => {
    const previous = theme
    setTheme(next) // apply instantly; the account copy is saved in the background
    savePreferences.mutate(
      { theme: next },
      {
        onError: () => {
          setTheme(previous)
          toast.error("Couldn't save your theme. Please try again.")
        },
      },
    )
  }

  const signOut = () =>
    logout.mutate(undefined, {
      onSettled: () => {
        navigate('/login', { replace: true })
        toast.success('Signed out')
      },
    })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label="Account and preferences"
      >
        <Avatar className="size-8">
          <AvatarFallback className="bg-secondary text-xs font-semibold text-secondary-foreground">
            {user ? initials(user.name) : <UserRoundIcon aria-hidden className="size-4" />}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {user ? (
          <DropdownMenuLabel className="font-normal">
            <span className="block truncate text-sm font-medium text-foreground">{user.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
          </DropdownMenuLabel>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link to="/settings/profile">
              <UserRoundIcon aria-hidden />
              Profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/settings/security">
              <ShieldCheckIcon aria-hidden />
              Security
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => chooseTheme(value as Theme)}
        >
          {themeOptions.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon aria-hidden />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut} disabled={logout.isPending}>
          <LogOutIcon aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
