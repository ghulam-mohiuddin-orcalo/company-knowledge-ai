import AxeBuilder from '@axe-core/playwright';
import { makePdf } from '@cka/ingestion/fixtures';
import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth';
import { ask, upload, waitForStatus } from '../support/product';

const HANDBOOK =
  'Northwind Employee Handbook. Every full-time employee receives 27 days of paid annual leave per year. Remote work is allowed up to 3 days per week.';

test.describe.serial('E7 product flows', () => {
  test('E7-T01: unauthenticated users are sent to sign-in and returned to their page', async ({
    page,
  }) => {
    await page.goto('/app/documents');
    await expect(page).toHaveURL(/localhost:8080\/default\/authorize/);
    await signIn(page, 'member', '/app/documents');
    await expect(
      page.getByRole('heading', { name: 'Documents' }),
    ).toBeVisible();
    await expect(page.getByTestId('current-role')).toHaveText(
      'Northwind Analytics · Member',
    );
  });

  test('E7-T01: navigation matches each role’s backend capabilities', async ({
    page,
  }) => {
    await signIn(page, 'member');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link')).toHaveText([
      'Dashboard',
      'Chat',
      'Documents',
    ]);
    // A member cannot reach admin pages, even by URL; the API also refuses.
    await page.goto('/app/organization');
    await expect(
      page.getByText('Only organization administrators'),
    ).toBeVisible();
    await page.goto('/app/documents');
    await expect(page.getByLabel('Upload a document')).toHaveCount(0);

    await page.getByRole('button', { name: 'Sign out' }).click();
    // Sign-out ends the IdP session and returns to the landing page.
    await page.waitForURL(
      (url) => url.origin === 'http://localhost:3100' && url.pathname === '/',
    );
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await signIn(page, 'admin');
    await expect(nav.getByRole('link')).toHaveText([
      'Dashboard',
      'Chat',
      'Documents',
      'Organization',
    ]);
    await page.goto('/app/organization');
    await expect(
      page.getByRole('cell', { name: 'e2e-member@example.test' }),
    ).toBeVisible();
  });

  test('E7-T01: platform admins see platform operations but no tenant pages', async ({
    page,
  }) => {
    await signIn(page, 'platform');
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link'),
    ).toHaveText(['Platform']);
    await expect(
      page.getByRole('heading', { name: 'No organization access' }),
    ).toBeVisible();
    await page.goto('/app/platform');
    await expect(
      page.getByRole('cell', { name: 'Northwind Analytics' }),
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'Contoso Legal' }),
    ).toBeVisible();
  });

  test('E2-T06: an admin uploads documents, sees processing status and failures, and deletes with confirmation', async ({
    page,
  }) => {
    await signIn(page, 'admin');
    await upload(
      page,
      'Employee Handbook.txt',
      'text/plain',
      Buffer.from(HANDBOOK),
    );
    await upload(
      page,
      'Travel Policy.pdf',
      'application/pdf',
      makePdf([
        ['Travel policy.'],
        ['Flights must be booked through the TravelPoint travel desk.'],
      ]),
    );
    await upload(page, 'Blank.txt', 'text/plain', Buffer.from('   \n  '));
    await waitForStatus(page, 'Employee Handbook.txt', 'Ready');
    await waitForStatus(page, 'Travel Policy.pdf', 'Ready');
    await waitForStatus(page, 'Blank.txt', 'Failed');
    await expect(page.getByRole('row', { name: /Blank\.txt/ })).toContainText(
      'No readable text was found',
    );

    // Unsupported types are rejected with a clear message.
    await page.getByLabel('Upload a document').setInputFiles({
      name: 'tool.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('MZ'),
    });
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(
      page.getByRole('form', { name: 'Upload document' }).getByRole('alert'),
    ).toContainText('This file type is not supported');

    // Delete asks for confirmation; Cancel keeps the document.
    await page.getByRole('button', { name: 'Delete Blank.txt' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Delete document' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('row', { name: /Blank\.txt/ })).toBeVisible();
    await page.getByRole('button', { name: 'Delete Blank.txt' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(page.getByText('“Blank.txt” was deleted')).toBeVisible();
    await expect(page.getByRole('row', { name: /Blank\.txt/ })).toHaveCount(0);
  });

  test('E7-T02/E7-T03: a member asks, gets a cited answer, opens and downloads the source', async ({
    page,
  }) => {
    await signIn(page, 'member');
    await page.goto('/app/chat');
    await page.getByRole('button', { name: 'New conversation' }).click();
    await expect(page).toHaveURL(/\/app\/chat\/[0-9a-f-]{36}$/);

    await ask(
      page,
      'How many days of paid annual leave does each employee receive?',
    );
    const answer = page.getByRole('article', { name: 'Answer' }).last();
    await expect(answer).toContainText('27 days of paid annual leave');
    await expect(
      answer.getByRole('button', { name: /Source 1: Employee Handbook\.txt/ }),
    ).toBeVisible();
    await expect(answer.getByRole('list', { name: 'Sources' })).toContainText(
      'Employee Handbook.txt',
    );

    await answer.getByRole('button', { name: /Source 1:/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Source 1' });
    await expect(drawer).toContainText(
      'Every full-time employee receives 27 days',
    );
    const download = page.waitForEvent('download');
    await drawer.getByRole('button', { name: 'Download original' }).click();
    expect((await download).suggestedFilename()).toBe('Employee Handbook.txt');
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);

    // PDF page locator.
    await ask(page, 'Where must flights be booked through the travel desk?');
    await expect(
      page.getByRole('article', { name: 'Answer' }).last(),
    ).toContainText('Page 2');

    // Unanswerable: explicit no-answer state.
    await ask(page, 'What is a good recipe for chocolate cake?');
    await expect(page.getByTestId('no-answer').last()).toContainText(
      'The answer is not available in the current knowledge base.',
    );
    // The conversation appears in the list with the first question as title.
    await expect(
      page
        .getByRole('navigation', { name: 'Conversations' })
        .getByRole('link')
        .first(),
    ).toContainText('How many days of paid annual leave');
  });

  test('E7-T03: a source of a deleted document is handled gracefully', async ({
    page,
  }) => {
    await signIn(page, 'member');
    await page.goto('/app/chat');
    await page
      .getByRole('navigation', { name: 'Conversations' })
      .getByRole('link')
      .first()
      .click();
    await expect(
      page.getByRole('article', { name: 'Answer' }).first(),
    ).toBeVisible();

    // The admin deletes the cited document in another session.
    const admin = await page.context().browser()!.newContext();
    const adminPage = await admin.newPage();
    await signIn(adminPage, 'admin', '/app/documents');
    await adminPage
      .getByRole('button', { name: 'Delete Employee Handbook.txt' })
      .click();
    await adminPage
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(adminPage.getByText('was deleted')).toBeVisible();
    await admin.close();

    await page
      .getByRole('article', { name: 'Answer' })
      .first()
      .getByRole('button', { name: /Source 1:/ })
      .click();
    await expect(page.getByRole('dialog')).toContainText(
      'This source is no longer available',
    );
  });

  test('E7-T01: a user in several organizations switches tenants', async ({
    page,
  }) => {
    await signIn(page, 'multi');
    await expect(
      page.getByRole('heading', { name: 'Choose an organization' }),
    ).toBeVisible();
    await page
      .getByLabel('Organization')
      .selectOption({ label: 'Northwind Analytics' });
    await expect(page.getByTestId('current-role')).toHaveText(
      'Northwind Analytics · Member',
    );
    await page.goto('/app/documents');
    await expect(
      page.getByRole('row', { name: /Travel Policy\.pdf/ }),
    ).toBeVisible();

    await page
      .getByLabel('Organization')
      .selectOption({ label: 'Contoso Legal' });
    await expect(page.getByTestId('current-role')).toHaveText(
      'Contoso Legal · Member',
    );
    await expect(page.getByText('No documents yet.')).toBeVisible();
    await expect(page.getByText('Travel Policy.pdf')).toHaveCount(0);
  });

  test('E7-T04: the dashboard shows readiness and recent conversations', async ({
    page,
  }) => {
    await signIn(page, 'member');
    const readiness = page.getByRole('region', { name: 'Knowledge readiness' });
    await expect(readiness).toContainText('Ready to answer questions');
    await expect(
      page.getByRole('region', { name: 'Recent conversations' }),
    ).toContainText('How many days of paid annual leave');
    await page.getByRole('button', { name: 'Ask a question' }).click();
    await expect(page).toHaveURL(/\/app\/chat\/[0-9a-f-]{36}$/);
  });

  test('E7-T05: upload and chat are usable with the keyboard only', async ({
    page,
  }) => {
    await signIn(page, 'admin');
    await page.goto('/app/documents');
    await expect(page.getByRole('table')).toBeVisible();
    // The first Tab reaches the skip link; it jumps to the main content.
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', { name: 'Skip to main content' }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
    await page.getByLabel('Upload a document').focus();
    await page.getByLabel('Upload a document').setInputFiles({
      name: 'Keyboard.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Keyboard users can upload documents too.'),
    });
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('button', { name: 'Upload', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('“Keyboard.txt” was uploaded')).toBeVisible();

    await page.goto('/app/chat');
    await page.getByRole('button', { name: 'New conversation' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/app\/chat\/[0-9a-f-]{36}$/);
    await page.getByLabel('Your question').focus();
    await page.keyboard.type(
      'Where must flights be booked through the travel desk?',
    );
    await page.keyboard.press('Enter');
    const sourceButton = page
      .getByRole('button', { name: /Source 1:/ })
      .first();
    await expect(sourceButton).toBeVisible();
    await sourceButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sourceButton).toBeFocused();
  });

  for (const [name, path] of [
    ['dashboard', '/app'],
    ['documents', '/app/documents'],
    ['chat', '/app/chat'],
  ] as const) {
    test(`E7-T05: ${name} has no serious accessibility violations and fits a phone`, async ({
      page,
    }) => {
      await signIn(page, 'admin', path);
      await expect(page.getByRole('main')).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      const serious = results.violations.filter((v) =>
        ['serious', 'critical'].includes(v.impact ?? ''),
      );
      expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

      await page.setViewportSize({ width: 375, height: 800 });
      await page.reload();
      await expect(page.getByRole('main')).toBeVisible();
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      for (const button of await page.getByRole('button').all()) {
        if (!(await button.isVisible())) continue;
        const box = (await button.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(375);
      }
    });
  }
});
