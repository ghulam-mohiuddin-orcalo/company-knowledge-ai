import { expect, type Page } from '@playwright/test';

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function upload(
  page: Page,
  name: string,
  mimeType: string,
  buffer: Buffer,
) {
  await page.goto('/app/documents');
  // Wait until the document list has loaded before choosing a file.
  await expect(
    page.getByText('No documents yet').or(page.getByRole('table')),
  ).toBeVisible();
  const input = page.getByLabel('Upload a document');
  await input.setInputFiles({ name, mimeType, buffer });
  await expect(input).toHaveValue(new RegExp(`${escapeRegExp(name)}$`));
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByText(`“${name}” was uploaded`)).toBeVisible();
}

export async function waitForStatus(page: Page, name: string, status: string) {
  // The page refreshes automatically while documents are processing.
  await expect(
    page.getByRole('row', { name: new RegExp(escapeRegExp(name)) }),
  ).toContainText(status, {
    timeout: 30_000,
  });
}

export async function ask(page: Page, question: string) {
  await page.getByLabel('Your question').fill(question);
  await page.getByRole('button', { name: 'Ask' }).click();
}
