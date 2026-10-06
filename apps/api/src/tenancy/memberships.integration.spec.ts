import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../app.module.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { createTestConfig } from '../testing/test-config.js';
import {
  createTestDatabase,
  type TestDatabase,
} from '../testing/test-database.js';
import { UsersService } from '../users/users.service.js';
import { MembershipAlreadyExistsError } from './memberships.repository.js';
import { MembershipsService } from './memberships.service.js';
import { TenantScope } from './tenant-scope.js';

describe('organizations and memberships (E1-T02)', () => {
  let db: TestDatabase;
  let moduleRef: TestingModule;
  let organizations: OrganizationsService;
  let memberships: MembershipsService;
  let users: UsersService;

  const createUser = (subject: string) =>
    users.resolveVerifiedIdentity({
      subject,
      email: `${subject}@example.test`,
      displayName: undefined,
    });

  beforeAll(async () => {
    db = await createTestDatabase();
    moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(createTestConfig({ DATABASE_URL: db.url }))],
    }).compile();
    organizations = moduleRef.get(OrganizationsService);
    memberships = moduleRef.get(MembershipsService);
    users = moduleRef.get(UsersService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await db?.drop();
  });

  it('creates organizations as ACTIVE with a trimmed name', async () => {
    const organization = await organizations.createOrganization('  Acme  ');

    expect(organization).toMatchObject({ name: 'Acme', status: 'ACTIVE' });
  });

  it('rejects empty organization names', async () => {
    await expect(organizations.createOrganization('   ')).rejects.toThrow(
      'Organization name must be',
    );
  });

  it('lets a user belong to an organization with a persisted role', async () => {
    const organization = await organizations.createOrganization('Org One');
    const admin = await createUser('t02-admin');
    const member = await createUser('t02-member');

    await memberships.addMember(
      TenantScope.forSystem(organization.id),
      admin.userId,
      'ORG_ADMIN',
    );
    await memberships.addMember(
      TenantScope.forSystem(organization.id),
      member.userId,
      'MEMBER',
    );

    expect(
      await memberships.listMembers(TenantScope.forSystem(organization.id)),
    ).toEqual([
      expect.objectContaining({ userId: admin.userId, role: 'ORG_ADMIN' }),
      expect.objectContaining({ userId: member.userId, role: 'MEMBER' }),
    ]);
  });

  it('lets one user belong to several organizations', async () => {
    const first = await organizations.createOrganization('Multi A');
    const second = await organizations.createOrganization('Multi B');
    const user = await createUser('t02-multi');

    await memberships.addMember(
      TenantScope.forSystem(first.id),
      user.userId,
      'MEMBER',
    );
    await memberships.addMember(
      TenantScope.forSystem(second.id),
      user.userId,
      'ORG_ADMIN',
    );

    expect(
      await memberships.listMembers(TenantScope.forSystem(first.id)),
    ).toEqual([
      expect.objectContaining({ userId: user.userId, role: 'MEMBER' }),
    ]);
    expect(
      await memberships.listMembers(TenantScope.forSystem(second.id)),
    ).toEqual([
      expect.objectContaining({ userId: user.userId, role: 'ORG_ADMIN' }),
    ]);
  });

  it('prevents duplicate memberships, even with a different role', async () => {
    const organization = await organizations.createOrganization('Dup Org');
    const user = await createUser('t02-dup');
    await memberships.addMember(
      TenantScope.forSystem(organization.id),
      user.userId,
      'MEMBER',
    );

    await expect(
      memberships.addMember(
        TenantScope.forSystem(organization.id),
        user.userId,
        'ORG_ADMIN',
      ),
    ).rejects.toBeInstanceOf(MembershipAlreadyExistsError);
    expect(
      await memberships.listMembers(TenantScope.forSystem(organization.id)),
    ).toHaveLength(1);
  });

  it('only lists members of the requested organization', async () => {
    const orgA = await organizations.createOrganization('Scope A');
    const orgB = await organizations.createOrganization('Scope B');
    const userA = await createUser('t02-scope-a');
    const userB = await createUser('t02-scope-b');
    await memberships.addMember(
      TenantScope.forSystem(orgA.id),
      userA.userId,
      'MEMBER',
    );
    await memberships.addMember(
      TenantScope.forSystem(orgB.id),
      userB.userId,
      'MEMBER',
    );

    const members = await memberships.listMembers(
      TenantScope.forSystem(orgA.id),
    );

    expect(members.map((m) => m.userId)).toEqual([userA.userId]);
  });
});
