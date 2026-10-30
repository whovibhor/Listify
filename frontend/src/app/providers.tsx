import { useState, type ReactNode } from 'react'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'

import { ThemeProvider } from '@/components/theme/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { createQueryClient } from '@/lib/query-client'

interface AppProvidersProps {
  children: ReactNode
  /** Injected by tests; the app creates its own. */
  queryClient?: QueryClient
}

export function AppProviders({ children, queryClient: injectedClient }: AppProvidersProps) {
  const [queryClient] = useState(() => injectedClient ?? createQueryClient())

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        {/* Honors the OS "reduce motion" setting for every Motion animation. */}
        <MotionConfig reducedMotion="user">
          <TooltipProvider delayDuration={300}>
            {children}
            <Toaster position="bottom-right" closeButton />
          </TooltipProvider>
        </MotionConfig>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
