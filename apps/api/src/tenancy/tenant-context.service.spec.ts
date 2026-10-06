import { ApiError } from '../common/api-error.js';
import type {
  MembershipsRepository,
  UserMembership,
} from './memberships.repository.js';
import { TenantContextService } from './tenant-context.service.js';

const ORG_A = '0b5f3f4e-1111-4a5a-9a5a-aaaaaaaaaaaa';
const ORG_B = '0b5f3f4e-2222-4b5b-9b5b-bbbbbbbbbbbb';
const user = {
  userId: 'user-1',
  email: 'u@example.test',
  displayName: null,
  isPlatformAdmin: false,
};

function membership(
  organizationId: string,
  overrides: Partial<UserMembership> = {},
): UserMembership {
  return {
    membershipId: `m-${organizationId.slice(9, 13)}`,
    organizationId,
    organizationStatus: 'ACTIVE',
    role: 'MEMBER',
    ...overrides,
  };
}

function service(memberships: UserMembership[]): TenantContextService {
  const repository = {
    listForUser: vi.fn().mockResolvedValue(memberships),
  } as unknown as MembershipsRepository;
  return new TenantContextService(repository);
}

async function expectApiError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status, code });
}

describe('TenantContextService (E1-T03)', () => {
  it('uses the only membership when no organization is requested', async () => {
    const principal = await service([
      membership(ORG_A, { role: 'ORG_ADMIN' }),
    ]).resolve(user, undefined);

    expect(principal).toEqual({
      userId: 'user-1',
      organizationId: ORG_A,
      membershipId: 'm-1111',
      role: 'ORG_ADMIN',
    });
  });

  it('selects a requested organization the user belongs to', async () => {
    const principal = await service([
      membership(ORG_A),
      membership(ORG_B, { role: 'ORG_ADMIN' }),
    ]).resolve(user, ORG_B.toUpperCase());

    expect(principal).toMatchObject({
      organizationId: ORG_B,
      role: 'ORG_ADMIN',
    });
  });

  it('refuses an organization the user does not belong to', async () => {
    await expectApiError(
      service([membership(ORG_A)]).resolve(user, ORG_B),
      403,
      'FORBIDDEN',
    );
  });

  it('refuses users without memberships', async () => {
    await expectApiError(
      service([]).resolve(user, undefined),
      403,
      'FORBIDDEN',
    );
  });

  it('requires a selection when the user has several memberships', async () => {
    await expectApiError(
      service([membership(ORG_A), membership(ORG_B)]).resolve(user, undefined),
      400,
      'ORGANIZATION_SELECTION_REQUIRED',
    );
  });

  it('refuses suspended organizations', async () => {
    await expectApiError(
      service([membership(ORG_A, { organizationStatus: 'SUSPENDED' })]).resolve(
        user,
        undefined,
      ),
      403,
      'ORGANIZATION_SUSPENDED',
    );
  });

  it.each(['', 'not-a-uuid', "'; DROP TABLE memberships; --"])(
    'rejects a malformed organization identifier %j',
    async (requested) => {
      await expectApiError(
        service([membership(ORG_A)]).resolve(user, requested),
        400,
        'VALIDATION_FAILED',
      );
    },
  );
});
