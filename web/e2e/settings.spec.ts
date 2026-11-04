import { test, expect } from '@playwright/test';

test('settings disconnect flow', async ({ page }) => {
  await page.goto('/client');
  await page.getByRole('button', { name: /演示模式/i }).click();
  await page.goto('/client/settings');
  await expect(page.getByText(/主机信息/)).toBeVisible();
  await expect(page.getByText(/用量/)).toBeVisible();
  await page.getByRole('button', { name: /断开连接/i }).click();
  await expect(page).toHaveURL(/\/client(\/)?$/);
  await expect(page.getByText(/连接/).or(page.getByText(/配对/))).toBeVisible();
});
