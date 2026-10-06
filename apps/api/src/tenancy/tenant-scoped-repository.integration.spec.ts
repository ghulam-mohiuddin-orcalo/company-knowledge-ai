import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../app.module.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { createTestConfig } from '../testing/test-config.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../testing/test-database.js';
import { UsersService } from '../users/users.service.js';
import { MembershipsRepository } from './memberships.repository.js';
import { TenantScope } from './tenant-scope.js';

describe('tenant-scoped repository lookups (E1-T05)', () => {
  let db: TestDatabase;
  let moduleRef: TestingModule;
  let repository: MembershipsRepository;
  let scopeA: TenantScope;
  let scopeB: TenantScope;
  let membershipA: string;
  let membershipB: string;
  let userB: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(createTestConfig({ DATABASE_URL: db.url }))],
    }).compile();
    repository = moduleRef.get(MembershipsRepository);
    const organizations = moduleRef.get(OrganizationsService);
    const users = moduleRef.get(UsersService);
    const user = async (subject: string) =>
      (
        await users.resolveVerifiedIdentity({
          subject,
          email: `${subject}@example.test`,
          displayName: undefined,
        })
      ).userId;

    scopeA = TenantScope.forSystem(
      (await organizations.createOrganization('A')).id,
    );
    scopeB = TenantScope.forSystem(
      (await organizations.createOrganization('B')).id,
    );
    userB = await user('t05-b');
    membershipA = (
      await repository.create(scopeA, {
        userId: await user('t05-a'),
        role: 'MEMBER',
      })
    ).id;
    membershipB = (
      await repository.create(scopeB, { userId: userB, role: 'ORG_ADMIN' })
    ).id;
  });

  afterAll(async () => {
    await moduleRef?.close();
    await db?.drop();
  });

  it('finds a record by ID only inside its own tenant', async () => {
    expect(await repository.findById(scopeA, membershipA)).toMatchObject({
      membershipId: membershipA,
    });
    expect(await repository.findById(scopeB, membershipB)).toMatchObject({
      membershipId: membershipB,
    });
  });

  it('returns nothing for another tenant’s ID, exactly as for an unknown ID', async () => {
    expect(await repository.findById(scopeA, membershipB)).toBeUndefined();
    expect(
      await repository.findById(scopeA, '00000000-0000-4000-8000-000000000000'),
    ).toBeUndefined();
  });

  it('lists only the scoped tenant’s records', async () => {
    const members = await repository.listMembers(scopeA);

    expect(members.map((m) => m.membershipId)).toEqual([membershipA]);
  });

  it('writes into the scoped tenant only', async () => {
    const created = await repository.create(scopeA, {
      userId: userB,
      role: 'MEMBER',
    });

    expect(created.organizationId).toBe(scopeA.organizationId);
    expect(
      (await repository.listMembers(scopeB)).map((m) => m.membershipId),
    ).toEqual([membershipB]);
  });
});
