import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const PASSWORD = 'correct horse battery staple'

async function registerFreshUser(page: Page, project: string) {
  await page.goto('/register')
  await page.getByLabel('Full name').fill('Katherine Johnson')
  await page.getByLabel('Email').fill(`tasks.${project}.${Date.now()}@example.com`)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome, Katherine!' })).toBeVisible()
}

async function snap(page: Page, project: string, name: string) {
  await page.screenshot({ path: `test-results/screens/${project}-${name}.png`, fullPage: true })
}

test('plan a day: quick add, details, subtasks, complete, review analytics', async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name
  await registerFreshUser(page, project)

  // Quick-add two tasks for today from My Day.
  await page.goto('/personal/my-day')
  const quickAdd = page.getByLabel('New task title')
  await quickAdd.fill('Prepare launch checklist')
  await quickAdd.press('Enter')
  await quickAdd.fill('Water the plants')
  await quickAdd.press('Enter')
  await expect(page.getByRole('heading', { name: 'Due today' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Prepare launch checklist' })).toBeVisible()

  // Open the task: set priority and a tag, then add two subtasks.
  await page.getByRole('link', { name: 'Prepare launch checklist' }).click()
  const task = page.getByRole('main')
  await expect(
    task.getByRole('heading', { level: 1, name: 'Prepare launch checklist' }),
  ).toBeVisible()
  await task.getByRole('button', { name: 'Edit', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Edit task' })
  await form.getByLabel('Priority').selectOption('high')
  await form.getByRole('button', { name: 'Add tags' }).click()
  await page.getByLabel('Find or create a tag').fill('launch')
  await page.getByLabel('Find or create a tag').press('Enter')
  await expect(form.getByRole('button', { name: 'Remove tag launch' })).toBeVisible()
  await page.keyboard.press('Escape')
  await form.getByRole('button', { name: 'Save changes' }).click()
  await expect(form).toBeHidden()

  await page
    .getByRole('navigation', { name: 'Task sections' })
    .getByRole('link', { name: 'Activity' })
    .click()
  await expect(task.getByText('created this task')).toBeVisible()
  await expect(task.getByText(/updated .*priority/)).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Task sections' })
    .getByRole('link', { name: 'Overview' })
    .click()

  const subtaskInput = task.getByLabel('New subtask title')
  await subtaskInput.fill('Book venue')
  await subtaskInput.press('Enter')
  await subtaskInput.fill('Send invites')
  await subtaskInput.press('Enter')
  await expect(task.getByText('Subtasks · 0/2')).toBeVisible()
  await snap(page, project, 'task-detail')

  // Parent can't be completed with open subtasks.
  await task.getByRole('button', { name: 'Complete', exact: true }).click()
  await expect(page.getByText(/open subtask/)).toBeVisible()

  await task.getByRole('checkbox', { name: 'Complete subtask “Book venue”' }).click()
  await task.getByRole('checkbox', { name: 'Complete subtask “Send invites”' }).click()
  await expect(task.getByText('Subtasks · 2/2')).toBeVisible()
  await task.getByRole('button', { name: 'Complete', exact: true }).click()
  await expect(task.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible()

  // A subtask has its own page, and links back to its parent.
  await task.getByRole('link', { name: 'Book venue' }).click()
  await expect(task.getByRole('heading', { level: 1, name: 'Book venue' })).toBeVisible()
  await task.getByRole('link', { name: 'Prepare launch checklist' }).click()
  await expect(
    task.getByRole('heading', { level: 1, name: 'Prepare launch checklist' }),
  ).toBeVisible()

  // Back on My Day, it has gone, and it shows up in Completed.
  await page.goto('/personal/my-day')
  await expect(page.getByRole('link', { name: 'Prepare launch checklist' })).toBeHidden()
  await snap(page, project, 'my-day')
  await page.getByRole('navigation', { name: 'Main' }).first().isVisible()
  await page.goto('/personal/completed')
  await expect(page.getByRole('link', { name: 'Prepare launch checklist' })).toBeVisible()

  // Filters live in the URL.
  await page.goto('/personal/tasks?priority=high')
  await expect(page.getByText('No tasks match these filters')).toBeVisible()

  // Analytics counts the completion.
  await page.goto('/personal/analytics')
  const completedTile = page.getByRole('main').getByRole('link', { name: /^completed/i })
  await expect(completedTile).toContainText('1')
  // Today's column (last in the series) settles at its full height: 1 of a 0–4 axis.
  await expect
    .poll(
      async () => (await page.locator('.recharts-bar-rectangle').last().boundingBox())?.height ?? 0,
    )
    .toBeGreaterThan(30)
  await snap(page, project, 'analytics')

  await page.getByRole('button', { name: 'Show table' }).click()
  await expect(page.getByRole('table')).toBeVisible()
})

test('subtasks entered faster than the server answers are all kept', async ({ page }, testInfo) => {
  await registerFreshUser(page, testInfo.project.name)
  await page.goto('/personal/my-day')
  const quickAdd = page.getByLabel('New task title')
  await quickAdd.fill('Pack for the trip')
  await quickAdd.press('Enter')
  await page.getByRole('link', { name: 'Pack for the trip' }).click()
  const task = page.getByRole('main')
  await expect(task.getByRole('heading', { level: 1, name: 'Pack for the trip' })).toBeVisible()

  // A slow connection: each save is still running when the next Enter is pressed.
  await page.route('**/api/v1/me/tasks', async (route) => {
    if (route.request().method() === 'POST') await new Promise((done) => setTimeout(done, 400))
    await route.continue()
  })
  const input = task.getByLabel('New subtask title')
  for (const title of ['Passport', 'Charger', 'Tickets']) {
    await input.fill(title)
    await input.press('Enter')
    await expect(input).toHaveValue('')
  }

  await expect(task.getByText('Subtasks · 0/3')).toBeVisible()
})

test('task pages have no detectable accessibility violations', async ({ page }, testInfo) => {
  await registerFreshUser(page, `a11y-${testInfo.project.name}`)
  await page.goto('/personal/tasks')
  await page.getByLabel('New task title').fill('Accessible task')
  await page.getByLabel('New task title').press('Enter')
  await expect(page.getByRole('link', { name: 'Accessible task' })).toBeVisible()

  for (const path of ['/personal/tasks', '/personal/my-day', '/personal/analytics']) {
    await page.goto(path)
    await expect(page.locator('h1')).toBeVisible()
    await page.waitForLoadState('networkidle')
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze()
    expect(
      results.violations,
      `${path}: ${results.violations.map((v) => v.id).join(', ')}`,
    ).toEqual([])
  }

  await page.goto('/personal/tasks')
  await page.getByRole('link', { name: 'Accessible task' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Accessible task' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500) // text fading in would fail the contrast check
  const taskPage = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze()
  expect(taskPage.violations, taskPage.violations.map((v) => v.id).join(', ')).toEqual([])

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
  await page.waitForTimeout(500) // mid-animation text would fail the contrast check
  const form = await new AxeBuilder({ page })
    .include('[role=dialog]')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze()
  expect(form.violations, form.violations.map((v) => v.id).join(', ')).toEqual([])
})
