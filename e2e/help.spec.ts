import { test, expect } from '@playwright/test';

test('topbar ? opens help drawer; chapters switch; Esc closes', async ({ page }) => {
  await page.goto('/');

  // Open via the topbar button.
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Help' });
  await expect(dialog).toBeVisible();

  // First chapter is Markdown Basics.
  await expect(dialog.getByRole('heading', { level: 1, name: 'Markdown Basics' })).toBeVisible();

  // Switch to Tags via the chapter list.
  await dialog.getByRole('button', { name: 'Tags' }).click();
  await expect(dialog.getByRole('heading', { level: 1, name: 'Tags' })).toBeVisible();
  await expect(page).toHaveURL(/[?&]help=tags(&|$)/);

  // Switch to Wiki Links.
  await dialog.getByRole('button', { name: 'Wiki Links' }).click();
  await expect(dialog.getByRole('heading', { level: 1, name: 'Wiki Links' })).toBeVisible();
  await expect(page).toHaveURL(/[?&]help=wiki-links(&|$)/);

  // Esc closes the drawer.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('deep link ?help=tags opens the drawer at the Tags chapter on first paint', async ({ page }) => {
  await page.goto('/?help=tags');
  const dialog = page.getByRole('dialog', { name: 'Help' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { level: 1, name: 'Tags' })).toBeVisible();
});
