import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ask, upload, waitForStatus } from '../support/product';

// Markup that would run script if any of it reached the DOM as HTML.
const IMG = '<img src=x onerror="window.__xss=1">';
const SCRIPT = '<script>window.__xss=2</script>';
const FILENAME = '<img src=x onerror=window.__xss=3>.txt';
const CONTENT = [
  'Northwind Security Notice.',
  `The vault code word is ${IMG} marigold falcon.`,
  `Unrelated footer ${SCRIPT} for testing.`,
].join('\n');

test.describe.serial('E8-T04 security regression (browser)', () => {
  test('the web app sends a restrictive Content-Security-Policy and framing protection', async ({
    page,
  }) => {
    const response = await page.goto('/');
    const headers = response!.headers();

    const csp = headers['content-security-policy'] ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');
  });

  test('markup in file names, document content and answers is rendered as inert text', async ({
    page,
  }) => {
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    const injected = () =>
      page.evaluate(() => (window as { __xss?: unknown }).__xss);

    await signIn(page, 'admin', '/app/documents');
    await upload(page, FILENAME, 'text/plain', Buffer.from(CONTENT));
    await waitForStatus(page, FILENAME, 'Ready');
    // The name is displayed literally in the document table.
    await expect(
      page.getByRole('cell', { name: FILENAME, exact: true }),
    ).toBeVisible();

    await page.goto('/app/chat');
    await page.getByRole('button', { name: 'New conversation' }).click();
    await ask(page, 'What is the vault code word in the security notice?');
    const answer = page.getByRole('article', { name: 'Answer' }).last();
    await expect(answer).toContainText('marigold falcon');

    await answer.getByRole('button', { name: /Source 1:/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Source 1' });
    await expect(drawer).toContainText(`The vault code word is ${IMG}`);
    await expect(drawer).toContainText(FILENAME);

    // Nothing was interpreted as HTML: no injected elements, script or dialogs.
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    await expect(page.locator('main script')).toHaveCount(0);
    expect(await injected()).toBeUndefined();
    expect(dialogs).toEqual([]);
  });

  test('a tampered citation request is refused without exposing content', async ({
    page,
  }) => {
    await signIn(page, 'member', '/app/chat');
    await page.route('**/v1/citations/*/source', (route) =>
      route.continue({
        url: route
          .request()
          .url()
          .replace(
            /citations\/[^/]+\/source$/,
            'citations/00000000-0000-4000-8000-000000000000/source',
          ),
      }),
    );
    await page.getByRole('button', { name: 'New conversation' }).click();
    await ask(page, 'What is the vault code word in the security notice?');
    const answer = page.getByRole('article', { name: 'Answer' }).last();
    await answer.getByRole('button', { name: /Source 1:/ }).click();

    const drawer = page.getByRole('dialog', { name: 'Source 1' });
    await expect(drawer).toContainText('This source could not be found.');
    await expect(drawer).not.toContainText('marigold');
  });
});
