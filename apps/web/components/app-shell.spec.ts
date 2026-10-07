import { me } from '@/test/session';
import { navigationFor } from './app-shell';

const labels = (m: ReturnType<typeof me>) =>
  navigationFor(m).map((i) => i.label);

describe('navigationFor (E7-T01)', () => {
  it('matches backend capabilities for each role', () => {
    expect(labels(me())).toEqual(['Dashboard', 'Chat', 'Documents']);
    expect(
      labels(
        me({
          activeOrganization: {
            id: 'o1',
            name: 'Acme',
            membershipId: 'm1',
            role: 'ORG_ADMIN',
          },
        }),
      ),
    ).toEqual(['Dashboard', 'Chat', 'Documents', 'Organization']);
  });

  it('shows platform operations only to platform admins, without tenant pages when not a member', () => {
    const platformAdmin = me({
      user: {
        id: 'p',
        email: 'p@example.test',
        displayName: null,
        isPlatformAdmin: true,
      },
      activeOrganization: null,
      organizations: [],
    });

    expect(labels(platformAdmin)).toEqual(['Platform']);
  });
});
