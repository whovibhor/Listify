import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test'

const PASSWORD = 'correct horse battery staple'

async function newUser(browser: Browser, testInfo: TestInfo, name: string, label: string) {
  const context = await browser.newContext({
    ...testInfo.project.use,
    baseURL: testInfo.project.use.baseURL,
  })
  const page = await context.newPage()
  await page.goto('/register')
  await page.getByLabel('Full name').fill(name)
  await page.getByLabel('Email').fill(`${label}.${testInfo.project.name}.${Date.now()}@example.com`)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: /^Welcome, / })).toBeVisible()
  return page
}

async function createOrganization(page: Page, name: string, searchable: boolean) {
  await page.goto('/organizations/new')
  await page.getByLabel('Organization name').fill(name)
  await page.getByRole('button', { name: 'Engineering' }).click()
  await page.getByRole('button', { name: 'Sales' }).click()
  if (searchable) await page.getByRole('switch').click()
  await page.getByRole('button', { name: 'Create organization' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  return Number(new URL(page.url()).pathname.split('/')[2])
}

test('request to join, approval, and what each person can then do', async ({
  browser,
}, testInfo) => {
  const orgName = `Acme ${testInfo.project.name} ${Date.now()}`
  const owner = await newUser(browser, testInfo, 'Olivia Owner', 'owner')
  const applicant = await newUser(browser, testInfo, 'Amy Applicant', 'applicant')

  const orgId = await createOrganization(owner, orgName, true)

  // Applicant finds it and asks to join Sales.
  await applicant.goto('/organizations/join')
  await applicant.getByLabel('Search organizations by name').fill(orgName)
  await applicant.getByRole('button', { name: `Request to join ${orgName}` }).click()
  const dialog = applicant.getByRole('dialog')
  await dialog.getByLabel('Department').selectOption({ label: 'Sales' })
  await dialog.getByLabel('Note to the administrator (optional)').fill('New sales hire')
  await dialog.getByRole('button', { name: 'Send request' }).click()
  await expect(applicant.getByText('Waiting for approval')).toBeVisible()

  // Pending means no access at all.
  await applicant.goto(`/org/${orgId}`)
  await expect(applicant.getByRole('heading', { name: 'Page not found' })).toBeVisible()

  // Owner sees it, with a count, and approves.
  await owner.goto(`/org/${orgId}/requests`)
  await expect(owner.getByText('New sales hire')).toBeVisible()
  await owner.getByRole('button', { name: 'Approve Amy Applicant' }).click()
  await owner.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
  await expect(owner.getByText('No pending requests')).toBeVisible()

  // Member now has the organization, without administration.
  await applicant.goto(`/org/${orgId}`)
  await expect(applicant.getByRole('heading', { level: 1, name: orgName })).toBeVisible()
  await applicant.goto(`/org/${orgId}/settings`)
  await expect(applicant.getByText("You don't have access to this page")).toBeVisible()
  await applicant.goto(`/org/${orgId}/departments`)
  await expect(applicant.getByRole('heading', { name: 'Sales', level: 2 })).toBeVisible()
  await expect(applicant.getByRole('heading', { name: 'Engineering', level: 2 })).toBeHidden()

  // Owner sees the new member and the audit trail.
  await owner.goto(`/org/${orgId}/members`)
  await expect(owner.getByText('Amy Applicant')).toBeVisible()
  await owner.goto(`/org/${orgId}/activity`)
  await expect(owner.getByText('approved Amy Applicant')).toBeVisible()
})

test('join a private organization with an invitation link', async ({ browser }, testInfo) => {
  const orgName = `Private ${testInfo.project.name} ${Date.now()}`
  const owner = await newUser(browser, testInfo, 'Olivia Owner', 'owner2')
  const invited = await newUser(browser, testInfo, 'Ian Invited', 'invited')
  const orgId = await createOrganization(owner, orgName, false)

  // Private: search finds nothing.
  await invited.goto('/organizations/join')
  await invited.getByLabel('Search organizations by name').fill(orgName)
  await expect(invited.getByText(/No organizations match/)).toBeVisible()

  await owner.goto(`/org/${orgId}/invitations`)
  await owner.getByRole('button', { name: 'Create link' }).click()
  const link = await owner.getByLabel('Invitation link').inputValue()

  await invited.goto(new URL(link).pathname)
  await expect(invited.getByRole('heading', { name: orgName })).toBeVisible()
  await invited.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(invited.getByRole('heading', { level: 1, name: orgName })).toBeVisible()

  // The link only works once.
  await invited.goto(new URL(link).pathname)
  await expect(invited.getByText("This invitation can't be used")).toBeVisible()
})

test('organization pages have no detectable accessibility violations', async ({
  browser,
}, testInfo) => {
  const owner = await newUser(browser, testInfo, 'Olivia Owner', 'owner3')
  const orgId = await createOrganization(owner, `A11y ${testInfo.project.name} ${Date.now()}`, true)

  for (const path of [
    '/organizations/new',
    '/organizations/join',
    `/org/${orgId}`,
    `/org/${orgId}/departments`,
    `/org/${orgId}/members`,
    `/org/${orgId}/requests`,
    `/org/${orgId}/invitations`,
    `/org/${orgId}/activity`,
    `/org/${orgId}/settings`,
  ]) {
    await owner.goto(path)
    await expect(owner.locator('h1').first()).toBeVisible()
    await owner.waitForLoadState('networkidle')
    const results = await new AxeBuilder({ page: owner })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze()
    expect(
      results.violations,
      `${path}: ${results.violations.map((v) => `${v.id} ${v.nodes[0]?.html.slice(0, 120)}`).join(' | ')}`,
    ).toEqual([])
  }
})
