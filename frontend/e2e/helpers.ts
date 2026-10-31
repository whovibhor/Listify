import { expect, type Browser, type Page, type TestInfo } from '@playwright/test'

export const PASSWORD = 'correct horse battery staple'

export async function newUser(browser: Browser, testInfo: TestInfo, name: string, label: string) {
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

export async function createOrganization(page: Page, name: string, searchable: boolean) {
  await page.goto('/organizations/new')
  await page.getByLabel('Organization name').fill(name)
  await page.getByRole('button', { name: 'Engineering' }).click()
  await page.getByRole('button', { name: 'Sales' }).click()
  if (searchable) await page.getByRole('switch').click()
  await page.getByRole('button', { name: 'Create organization', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  return Number(new URL(page.url()).pathname.split('/')[2])
}

/** Calls the real API with the page's own session, as the SPA does. */
export async function apiPost(page: Page, path: string, data: object) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'denote_csrf')?.value ?? ''
  const response = await page.request.post(`/api/v1${path}`, {
    data,
    headers: { 'X-CSRF-Token': csrf },
  })
  expect(response.ok(), await response.text()).toBe(true)
  return response.status() === 204 ? null : response.json()
}

export async function departmentId(page: Page, orgId: number, name: string) {
  const response = await page.request.get(`/api/v1/organizations/${orgId}/departments`)
  const departments: { id: number; name: string }[] = await response.json()
  return departments.find((department) => department.name === name)!.id
}

/** Adds someone to a department through a real invitation link. */
export async function inviteToDepartment(owner: Page, guest: Page, orgId: number, name: string) {
  const { link } = await apiPost(owner, `/organizations/${orgId}/invitations`, {
    department_id: await departmentId(owner, orgId, name),
  })
  await guest.goto(new URL(link).pathname)
  await guest.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(guest.getByRole('heading', { level: 1 })).toBeVisible()
}
