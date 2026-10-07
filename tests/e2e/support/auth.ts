import { expect, type Page } from '@playwright/test';
import { API_AUDIENCE, type E2EUser, USERS } from './env';

/**
 * Signs in through the real browser flow: the app redirects to the mock OIDC
 * provider, which issues a signed token for the given subject and claims.
 */
export async function signIn(
  page: Page,
  user: E2EUser,
  path = '/app',
): Promise<void> {
  const subject = USERS[user];
  await page.goto(path);
  await page.waitForURL(/localhost:8080\/default\/authorize/);
  await page.fill('input[name="username"]', subject);
  await page.fill(
    'textarea[name="claims"]',
    JSON.stringify({
      email: `${subject}@example.test`,
      name: subject,
      aud: API_AUDIENCE,
    }),
  );
  await page.click('input[type="submit"]');
  await page.waitForURL((url) => url.pathname === path);
  await expect(page.getByText(`Signed in as`)).toBeVisible();
}
