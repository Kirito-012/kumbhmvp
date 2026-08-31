import { test, expect } from '@playwright/test'

test('unauthenticated visitors are redirected to /login', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
})

test('login page renders the credentials form', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByPlaceholder('you@company.com')).toBeVisible()
  await expect(page.getByPlaceholder('••••••••••')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})

test('submitting invalid credentials shows an error', async ({ page }) => {
  await page.goto('/login')
  await page.getByPlaceholder('you@company.com').fill('nobody@example.com')
  await page.getByPlaceholder('••••••••••').fill('wrong-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Invalid email or password.')).toBeVisible()
})
