import { motion } from 'motion/react'
import {
  ArrowRightIcon,
  Building2Icon,
  ListTodoIcon,
  UsersRoundIcon,
  type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router'

import { PageHeader } from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { useMe } from '@/features/auth/api'
import { transitions } from '@/lib/motion'
import { cn } from '@/lib/utils'

interface Choice {
  icon: LucideIcon
  title: string
  description: string
  to?: string
  availableIn?: string
}

const choices: Choice[] = [
  {
    icon: ListTodoIcon,
    title: 'Plan my own work',
    description: 'Start with private tasks only you can see.',
    to: '/personal/my-day',
  },
  {
    icon: Building2Icon,
    title: 'Create an organization',
    description: 'Set up departments and invite your team.',
    availableIn: 'Phase 3',
  },
  {
    icon: UsersRoundIcon,
    title: 'Join an organization',
    description: 'Request access to your team’s workspace.',
    availableIn: 'Phase 3',
  },
]

/** Onboarding shown right after registration (PRD §6.1). */
export function WelcomePage() {
  const { data: user } = useMe()
  const firstName = user?.name.split(' ')[0]

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title={firstName ? `Welcome, ${firstName}!` : 'Welcome!'}
        description="How would you like to start? You can do the others any time."
      />
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {choices.map((choice, index) => {
          const content = (
            <>
              <span className="grid size-10 place-items-center rounded-lg bg-accent text-accent-foreground">
                <choice.icon aria-hidden className="size-5" />
              </span>
              <span className="space-y-1">
                <span className="flex items-center gap-2 font-medium">
                  {choice.title}
                  {choice.availableIn ? (
                    <Badge variant="secondary">{choice.availableIn}</Badge>
                  ) : null}
                </span>
                <span className="block text-sm text-muted-foreground">{choice.description}</span>
              </span>
            </>
          )
          const base =
            'flex h-full flex-col gap-3 rounded-xl border bg-card p-4 text-left shadow-card transition-[box-shadow,transform,border-color] duration-(--duration-base)'
          return (
            <motion.li
              key={choice.title}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...transitions.base, delay: index * 0.05 }}
            >
              {choice.to ? (
                <Link
                  to={choice.to}
                  className={cn(
                    base,
                    'outline-none hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-raised focus-visible:ring-3 focus-visible:ring-ring/50',
                  )}
                >
                  {content}
                </Link>
              ) : (
                <div aria-disabled className={cn(base, 'opacity-70')}>
                  {content}
                </div>
              )}
            </motion.li>
          )
        })}
      </ul>
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Skip for now
        <ArrowRightIcon aria-hidden className="size-4" />
      </Link>
    </div>
  )
}
