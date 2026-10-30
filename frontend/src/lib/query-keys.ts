/** Query keys shared across features. Feature-local keys live next to their API hooks. */
export const ME_QUERY_KEY = ['auth', 'me'] as const
export const MY_ORGANIZATIONS_QUERY_KEY = ['organizations', 'mine'] as const
