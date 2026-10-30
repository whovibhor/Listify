export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

let cached: string[] | null = null

/** IANA zone names known to the browser, always including UTC (some engines omit it). */
export function timezoneOptions(): string[] {
  if (!cached) {
    const zones =
      typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
    cached = Array.from(new Set(['UTC', ...zones]))
  }
  return cached
}
