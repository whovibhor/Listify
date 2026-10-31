import { useEffect } from 'react'
import { useLocation, useMatch, useOutletContext, type Location } from 'react-router'

import { useMe, useUpdatePreferences } from '@/features/auth/api'
import { useMyOrganizations } from '@/features/organizations/api'
import type { MyOrganization } from '@/features/organizations/types'

function isPersonalPath(pathname: string) {
  return pathname === '/' || pathname === '/inbox' || pathname.startsWith('/personal')
}

/** A fresh visit or sign-in to `/`, not someone choosing Personal: reopens the last workspace. */
export function isResumingWorkspace(location: Location) {
  return (
    location.pathname === '/' &&
    (location.key === 'default' || location.state?.resumeWorkspace === true)
  )
}

/**
 * The workspace the shell shows, or null for Personal. The URL decides it on workspace pages;
 * pages that belong to neither, such as Settings, keep the one the user was last in.
 */
export function useActiveOrganization(): MyOrganization | null {
  const { pathname } = useLocation()
  const match = useMatch('/org/:organizationId/*')
  const { data: user } = useMe()
  const { data: organizations } = useMyOrganizations()
  const id = match
    ? Number(match.params.organizationId)
    : isPersonalPath(pathname)
      ? null
      : user?.last_organization_id
  return organizations?.find((organization) => organization.id === id) ?? null
}

/** Saves the workspace the user is in to their account, so it reopens on their next visit. */
export function useRememberWorkspace() {
  const location = useLocation()
  const { data: user } = useMe()
  const active = useActiveOrganization()
  const { data: organizations } = useMyOrganizations()
  const { mutate } = useUpdatePreferences()
  const onOrganization = location.pathname.startsWith('/org/')
  const onPersonal = isPersonalPath(location.pathname) && !isResumingWorkspace(location)
  const saved = user?.last_organization_id
  const current = onOrganization ? active?.id : onPersonal ? null : undefined

  useEffect(() => {
    if (saved === undefined || !organizations || current === undefined || current === saved) return
    mutate({ last_organization_id: current })
  }, [current, mutate, organizations, saved])
}

/** Inside `/org/:id` pages: provided by OrganizationLayout, always present. */
export function useOrg() {
  return useOutletContext<MyOrganization>()
}
