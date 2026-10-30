import { motion } from 'motion/react'
import { CheckCircle2Icon } from 'lucide-react'
import { Link, Outlet } from 'react-router'

import { Logo } from '@/components/shared/Logo'
import { pageEnter } from '@/lib/motion'

const highlights = [
  'Private personal tasks that stay yours',
  'Department boards with clear ownership',
  'Dashboards built on honest, timezone-aware numbers',
]

/** Two-column layout for sign-in flows; the brand panel collapses away on small screens. */
export function AuthLayout() {
  return (
    <div className="grid min-h-svh grid-cols-1 bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-primary p-10 text-primary-foreground lg:flex lg:flex-col">
        <div
          aria-hidden
          className="absolute -top-24 -right-24 size-96 rounded-full bg-primary-foreground/10 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -bottom-32 -left-20 size-96 rounded-full bg-primary-foreground/5 blur-3xl"
        />
        <Link
          to="/"
          className="relative w-fit rounded-md [&_path]:stroke-primary [&_rect]:fill-primary-foreground"
        >
          <Logo />
        </Link>
        <div className="relative mt-auto max-w-md space-y-6">
          <h2 className="text-3xl leading-tight font-semibold tracking-tight text-balance">
            Your work and your team&rsquo;s work, finally in one calm place.
          </h2>
          <ul className="space-y-3">
            {highlights.map((item) => (
              <li
                key={item}
                className="flex items-start gap-2.5 text-sm text-primary-foreground/90"
              >
                <CheckCircle2Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="flex flex-col px-4 py-8 sm:px-8">
        <Link to="/" className="mb-10 w-fit rounded-md lg:hidden">
          <Logo />
        </Link>
        <motion.div {...pageEnter} className="m-auto w-full max-w-sm">
          <Outlet />
        </motion.div>
      </main>
    </div>
  )
}

export function AuthHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6 space-y-1.5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  )
}

export function FormAlert({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <motion.p
      role="alert"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg bg-destructive/8 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </motion.p>
  )
}
