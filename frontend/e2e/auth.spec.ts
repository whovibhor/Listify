import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const PASSWORD = 'correct horse battery staple'

function uniqueEmail(project: string) {
  return `e2e.${project}.${Date.now()}@example.com`
}

async function openAccountMenu(page: Page) {
  await page.getByRole('button', { name: 'Account and preferences' }).click()
}

// "Password" alone would also match the "Show password" toggle button.
const passwordField = (page: Page) => page.getByLabel('Password', { exact: true })

test('register, sign out, sign in again and come back to a protected page', async ({
  page,
}, testInfo) => {
  const email = uniqueEmail(testInfo.project.name)

  // Protected page -> sign-in with a return path.
  await page.goto('/settings/security')
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fsecurity$/)

  // Register.
  await page.getByRole('link', { name: 'Create an account' }).click()
  await page.getByLabel('Full name').fill('Grace Hopper')
  await page.getByLabel('Email').fill(email)
  await passwordField(page).fill(PASSWORD)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome, Grace!' })).toBeVisible()

  // Sign out.
  await openAccountMenu(page)
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

  // Wrong password -> generic error.
  await page.getByLabel('Email').fill(email)
  await passwordField(page).fill('not the right password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.')

  // Correct password, then the session survives a reload.
  await passwordField(page).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Hi, Grace' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Hi, Grace' })).toBeVisible()

  // Security page lists this device.
  await page.goto('/settings/security')
  await expect(page.getByText('This device', { exact: true })).toBeVisible()
})

test('sign-in and registration pages have no detectable accessibility violations', async ({
  page,
}) => {
  for (const path of ['/login', '/register', '/forgot-password']) {
    await page.goto(path)
    await expect(page.locator('h1')).toBeVisible()
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze()
    expect(
      results.violations,
      `${path}: ${results.violations.map((v) => v.id).join(', ')}`,
    ).toEqual([])
  }
})
