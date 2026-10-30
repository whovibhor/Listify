import { useMatch } from 'react-router'
import { useOutletContext } from 'react-router'

import { useMyOrganizations } from '@/features/organizations/api'
import type { MyOrganization } from '@/features/organizations/types'

/** The organization whose workspace the URL is in, or null in the Personal workspace. */
export function useActiveOrganization(): MyOrganization | null {
  const match = useMatch('/org/:organizationId/*')
  const { data: organizations } = useMyOrganizations()
  const id = Number(match?.params.organizationId)
  return organizations?.find((organization) => organization.id === id) ?? null
}

/** Inside `/org/:id` pages: provided by OrganizationLayout, always present. */
export function useOrg() {
  return useOutletContext<MyOrganization>()
}
