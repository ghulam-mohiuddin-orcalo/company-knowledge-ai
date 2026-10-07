import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

/**
 * The deterministic demo path (E9-T04, docs/demo/DEMO_SCRIPT.md) against a
 * deployed environment: upload -> Ready, grounded answer with citation,
 * unknown answer, admin/member permissions, delete -> no longer answered.
 * Leaves the demo organization without demo documents, so it can be re-run.
 */
const API_URL = process.env.DEPLOY_API_URL ?? 'https://api.localhost';
const IDP_URL = process.env.DEPLOY_IDP_URL ?? 'https://auth.localhost/default';
const AUDIENCE = process.env.DEPLOY_API_AUDIENCE ?? 'company-knowledge-api';
const DOCS = new URL('../../../docs/demo/documents/', import.meta.url);
const HANDBOOK = 'Northwind Employee Handbook.txt';
const SECURITY = 'IT Security Policy.txt';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const row = (page: Page, name: string) =>
  page.getByRole('row', { name: new RegExp(escape(name)) });

async function signIn(page: Page, subject: string) {
  await page.goto('/app');
  await page.waitForURL((url) => url.href.startsWith(`${IDP_URL}/authorize`));
  await page.fill('input[name="username"]', subject);
  await page.fill(
    'textarea[name="claims"]',
    JSON.stringify({
      email: `${subject}@example.test`,
      name: subject,
      aud: AUDIENCE,
    }),
  );
  await page.click('input[type="submit"]');
  await page.waitForURL((url) => url.pathname === '/app');
  await expect(page.getByTestId('current-role')).toBeVisible();
}

async function openDocuments(page: Page) {
  await page.goto('/app/documents');
  await expect(
    page.getByText('No documents yet').or(page.getByRole('table')),
  ).toBeVisible();
}

async function deleteDocument(page: Page, name: string) {
  await page
    .getByRole('button', { name: `Delete ${name}` })
    .first()
    .click();
  await page
    .getByRole('dialog', { name: 'Delete document' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.getByText(`“${name}” was deleted`)).toBeVisible();
}

async function newConversation(page: Page) {
  await page.goto('/app');
  await page.getByRole('button', { name: 'Ask a question' }).click();
  await page.waitForURL(/\/app\/chat\/.+/);
}

async function ask(page: Page, question: string) {
  await page.getByLabel('Your question').fill(question);
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByRole('button', { name: 'Ask' })).toBeVisible({
    timeout: 60_000,
  });
}

test.describe.serial('demo path on the deployed environment', () => {
  let admin: Page;
  let member: Page;

  test.beforeAll(async ({ browser }) => {
    admin = await (await browser.newContext()).newPage();
    member = await (await browser.newContext()).newPage();
  });

  test('1. admin signs in and uploads the demo documents, which become Ready', async () => {
    await signIn(admin, 'demo-admin');
    await expect(admin.getByTestId('current-role')).toContainText(
      'Organization admin',
    );
    await openDocuments(admin);
    // Start from a clean slate if an earlier run stopped half-way.
    for (const name of [HANDBOOK, SECURITY]) {
      while ((await row(admin, name).count()) > 0)
        await deleteDocument(admin, name);
    }
    for (const name of [HANDBOOK, SECURITY]) {
      await admin.getByLabel('Upload a document').setInputFiles({
        name,
        mimeType: 'text/plain',
        buffer: readFileSync(new URL(name, DOCS)),
      });
      await admin.getByRole('button', { name: 'Upload', exact: true }).click();
      await expect(admin.getByText(`“${name}” was uploaded`)).toBeVisible();
    }
    for (const name of [HANDBOOK, SECURITY]) {
      await expect(row(admin, name)).toContainText('Ready', {
        timeout: 60_000,
      });
    }
  });

  test('2. a grounded answer cites the handbook and the source opens', async () => {
    await newConversation(admin);
    await ask(
      admin,
      'How many days of annual leave do full-time employees receive?',
    );
    const answer = admin.getByRole('article', { name: 'Answer' }).last();
    await expect(answer).toContainText('25 days of annual leave');
    await answer
      .getByRole('list', { name: 'Sources' })
      .getByRole('button', { name: HANDBOOK })
      .click();
    const source = admin.getByRole('dialog');
    await expect(source).toContainText(HANDBOOK);
    await expect(source.locator('pre')).toContainText('25 days');
    await admin.keyboard.press('Escape');
    await expect(source).toBeHidden();
  });

  test('3. a member sees documents read-only and gets cited answers', async () => {
    await signIn(member, 'demo-member');
    await expect(member.getByTestId('current-role')).toContainText('Member');
    await expect(
      member.getByRole('link', { name: 'Organization' }),
    ).toHaveCount(0);
    await openDocuments(member);
    await expect(row(member, SECURITY)).toContainText('Ready');
    await expect(member.getByLabel('Upload a document')).toHaveCount(0);
    await expect(member.getByRole('button', { name: /^Delete/ })).toHaveCount(
      0,
    );

    await newConversation(member);
    await ask(member, 'How do I report a lost or stolen laptop?');
    const answer = member.getByRole('article', { name: 'Answer' }).last();
    await expect(answer).toContainText('extension 4357');
    await expect(answer.getByRole('list', { name: 'Sources' })).toContainText(
      SECURITY,
    );
  });

  test('4. a question the documents do not cover gets the no-answer response', async () => {
    await ask(member, 'Who won the football World Cup in 1966?');
    await expect(member.getByTestId('no-answer').last()).toBeVisible();
  });

  test('5. the server refuses a member deleting a document through the API', async () => {
    await openDocuments(admin);
    const id = await admin.evaluate(
      async ({ api, name }) => {
        const key = Object.keys(sessionStorage).find((k) =>
          k.startsWith('oidc.user:'),
        )!;
        const token = (
          JSON.parse(sessionStorage.getItem(key)!) as { access_token: string }
        ).access_token;
        const response = await fetch(`${api}/v1/documents?limit=50`, {
          headers: { authorization: `Bearer ${token}` },
        });
        const page = (await response.json()) as {
          items: { id: string; filename: string }[];
        };
        return page.items.find((d) => d.filename === name)!.id;
      },
      { api: API_URL, name: SECURITY },
    );
    const status = await member.evaluate(
      async ({ api, id }) => {
        const key = Object.keys(sessionStorage).find((k) =>
          k.startsWith('oidc.user:'),
        )!;
        const token = (
          JSON.parse(sessionStorage.getItem(key)!) as { access_token: string }
        ).access_token;
        return (
          await fetch(`${api}/v1/documents/${id}`, {
            method: 'DELETE',
            headers: { authorization: `Bearer ${token}` },
          })
        ).status;
      },
      { api: API_URL, id },
    );
    expect(status).toBe(403);
    await openDocuments(admin);
    await expect(row(admin, SECURITY)).toContainText('Ready');
  });

  test('6. after the admin deletes the documents, they no longer answer', async () => {
    await openDocuments(admin);
    await deleteDocument(admin, HANDBOOK);
    await deleteDocument(admin, SECURITY);
    await newConversation(admin);
    await ask(
      admin,
      'How many days of annual leave do full-time employees receive?',
    );
    await expect(admin.getByTestId('no-answer').last()).toBeVisible();
  });
});
