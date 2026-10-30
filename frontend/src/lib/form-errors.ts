import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'

import { ApiError } from '@/lib/api-client'

/**
 * Copies server field errors (ADR-012 `details`) onto the matching form fields.
 * Returns the message to show at form level when nothing could be attached to a field.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): string | null {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.'
  let attached = false
  for (const detail of error.details) {
    const field = detail.field as Path<T> | undefined
    if (field && fields.includes(field)) {
      setError(field, { type: 'server', message: detail.message }, { shouldFocus: !attached })
      attached = true
    }
  }
  return attached ? null : error.message
}

/** Accepts only same-app relative paths, so `?next=` can't redirect off-site. */
export function safeRedirectPath(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return fallback
  }
  return next
}
