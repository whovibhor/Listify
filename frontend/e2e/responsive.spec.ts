import { expect, test, type Page } from '@playwright/test'

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
] as const

const PAGES = [
  { path: '/', heading: /^Hi, /, name: 'home' },
  { path: '/personal/my-day', heading: 'My Day', name: 'my-day' },
  { path: '/personal/tasks', heading: 'My Tasks', name: 'my-tasks' },
  { path: '/personal/upcoming', heading: 'Upcoming', name: 'upcoming' },
  { path: '/personal/completed', heading: 'Completed', name: 'completed' },
  { path: '/personal/analytics', heading: 'Personal analytics', name: 'analytics' },
] as const

function localDate(offsetDays: number) {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return date.toLocaleDateString('en-CA') // YYYY-MM-DD in the browser's (= user's) timezone
}

/** Creates realistic data through the real API (same session cookie + CSRF as the SPA). */
async function seedTasks(page: Page) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'wp_csrf')?.value ?? ''
  const post = async (path: string, data: object) => {
    const response = await page.request.post(`/api/v1${path}`, {
      data,
      headers: { 'X-CSRF-Token': csrf },
    })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const work = await post('/me/tags', { name: 'work', color: 'violet' })
  const home = await post('/me/tags', { name: 'home', color: 'green' })
  await post('/me/tasks', {
    title: 'Renew passport application',
    due_date: localDate(-2),
    priority: 'urgent',
  })
  await post('/me/tasks', {
    title: 'Prepare the quarterly planning deck for the leadership offsite',
    due_date: localDate(0),
    due_time: '16:30',
    priority: 'high',
    tag_ids: [work.id],
  })
  const groceries = await post('/me/tasks', {
    title: 'Groceries',
    due_date: localDate(0),
    tag_ids: [home.id],
  })
  await post('/me/tasks', { title: 'Milk', parent_task_id: groceries.id })
  await post('/me/tasks', {
    title: 'Call the plumber',
    due_date: localDate(1),
    status: 'in_progress',
  })
  await post('/me/tasks', { title: 'Team retro notes', due_date: localDate(3), tag_ids: [work.id] })
  await post('/me/tasks', { title: 'Book dentist', due_date: localDate(9), priority: 'low' })
  await post('/me/tasks', { title: 'Read “Deep Work”' })
  const done = await post('/me/tasks', { title: 'Morning run', due_date: localDate(0) })
  await post(`/tasks/${done.id}/complete`, {})
}

test('every personal page fits phone, tablet and desktop widths', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'viewports are set explicitly in this test')
  test.setTimeout(120_000)

  await page.goto('/register')
  await page.getByLabel('Full name').fill('Mary Jackson')
  await page.getByLabel('Email').fill(`responsive.${Date.now()}@example.com`)
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome, Mary!' })).toBeVisible()
  await seedTasks(page)

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    for (const target of PAGES) {
      await page.goto(target.path)
      await expect(page.getByRole('heading', { level: 1, name: target.heading })).toBeVisible()
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(400) // let entrance animations settle before measuring
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )
      expect(
        overflow,
        `${target.path} overflows horizontally at ${viewport.width}px`,
      ).toBeLessThanOrEqual(0)
      await page.screenshot({
        path: `test-results/screens/responsive-${viewport.name}-${target.name}.png`,
        fullPage: true,
      })
    }
    // The task panel at this width.
    await page.goto('/personal/my-day')
    await page.getByRole('button', { name: /quarterly planning deck/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `test-results/screens/responsive-${viewport.name}-panel.png` })
  }
})
