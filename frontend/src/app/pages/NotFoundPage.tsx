import { CompassIcon } from 'lucide-react'
import { Link } from 'react-router'

import { EmptyState } from '@/components/shared/StatePanels'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <EmptyState
      icon={CompassIcon}
      title="Page not found"
      description="The page you're looking for doesn't exist or you don't have access to it."
      action={
        <Button asChild>
          <Link to="/">Go to Home</Link>
        </Button>
      }
    />
  )
}
