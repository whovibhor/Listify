import { expect, test, type Page } from '@playwright/test'

import { createOrganization, newUser } from './helpers.js'

async function savedWorkspace(page: Page) {
  const response = await page.request.get('/api/v1/me')
  return (await response.json()).last_organization_id
}

test('the workspace stays where you left it', async ({ browser }, testInfo) => {
  const orgName = `Workspace ${testInfo.project.name} ${Date.now()}`
  const page = await newUser(browser, testInfo, 'Wendy Worker', 'workspace')

  // Create and Join sit in the header until the first organization exists.
  await expect(page.getByRole('button', { name: 'Join or create organization' })).toBeVisible()
  const orgId = await createOrganization(page, orgName, false)
  await expect(page.getByRole('link', { name: 'Switch to Personal' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Join or create organization' })).toHaveCount(0)
  await expect.poll(() => savedWorkspace(page)).toBe(orgId)

  // The bell opens this workspace's inbox, without leaving the workspace.
  await page.getByRole('link', { name: 'Notifications' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe(`/org/${orgId}/inbox`)
  await expect(page.getByRole('link', { name: 'Switch to Personal' })).toBeVisible()

  // Coming back to the app reopens the organization.
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: orgName })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe(`/org/${orgId}`)

  // Choosing Personal is never overruled.
  await page.getByRole('link', { name: 'Switch to Personal' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Hi, / })).toBeVisible()
  await expect.poll(() => savedWorkspace(page)).toBeNull()
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: /^Hi, / })).toBeVisible()
  await expect(page.getByRole('link', { name: `Switch to ${orgName}` })).toBeVisible()

  // Create and Join now live in Account settings.
  await page.goto('/settings/organizations')
  const main = page.getByRole('main')
  await expect(main.getByRole('link', { name: 'Create an organization' })).toBeVisible()
  await expect(main.getByRole('link', { name: 'Join an organization' })).toBeVisible()
})

test('the collapsed sidebar is saved to the account', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Phones use the slide-out menu.')
  const page = await newUser(browser, testInfo, 'Sid Sidebar', 'sidebar')
  await createOrganization(page, `Sidebar ${Date.now()}`, false)
  const sidebar = page.getByRole('complementary')

  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
  await expect(sidebar.getByRole('link', { name: 'Team Tasks' })).toHaveText('')
  await expect(sidebar).toHaveCSS('width', '56px')

  await page.reload()
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
  await sidebar.getByRole('button', { name: 'Boards' }).click()
  await page.getByRole('menuitem', { name: 'Sales' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Sales' })).toBeVisible()

  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  await expect(sidebar.getByRole('link', { name: 'Team Tasks' })).toHaveText('Team Tasks')
})
