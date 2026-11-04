import { test, expect } from '@playwright/test';

test('demo chat flow with mock transport', async ({ page }) => {
  await page.goto('/client');
  // 演示模式进入
  await page.getByRole('button', { name: /演示模式/i }).click();
  await expect(page).toHaveURL(/\/client\/chat/);
  // bot 列表可见
  await expect(page.getByText(/Claude 演示/)).toBeVisible();
  await page.getByText(/Claude 演示/).click();
  // ThreadView 渲染
  await expect(page.getByRole('textbox', { name: /输入消息/i })).toBeVisible();
  await page.getByRole('textbox', { name: /输入消息/i }).fill('测试消息');
  await page.getByRole('button', { name: /发送/i }).click();
  // 看到新消息气泡
  await expect(page.getByText('测试消息')).toBeVisible();
});
