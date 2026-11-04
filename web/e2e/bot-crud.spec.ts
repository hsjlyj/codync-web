import { test, expect } from '@playwright/test';

test('bot crud with mock transport', async ({ page }) => {
  await page.goto('/client');
  await page.getByRole('button', { name: /演示模式/i }).click();
  await page.goto('/client/bots');
  await expect(page.getByRole('heading', { name: /机器人管理/ })).toBeVisible();
  await page.getByRole('button', { name: /新建机器人/i }).click();
  await page.getByLabel(/名称/).fill('TestBot');
  await page.getByLabel(/后端/).selectOption('claude');
  await page.getByRole('button', { name: /创建/i }).click();
  await expect(page.getByText('TestBot')).toBeVisible();
  // 编辑
  await page.getByRole('button', { name: /编辑/ }).first().click();
  await page.getByLabel(/名称/).fill('TestBotEdited');
  await page.getByRole('button', { name: /保存/i }).click();
  await expect(page.getByText('TestBotEdited')).toBeVisible();
  // 删除
  await page.getByRole('button', { name: /删除/ }).first().click();
  await page.getByRole('button', { name: /确认删除/i }).click();
  await expect(page.getByText('TestBotEdited')).not.toBeVisible();
});
