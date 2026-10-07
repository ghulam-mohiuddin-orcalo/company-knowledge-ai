import { parseArgs } from 'node:util';
import { loadDatabaseConfigOrExit, loadEnvFileIfPresent } from '@cka/config';
import { and, eq } from 'drizzle-orm';
import { isMainModule } from './cli.js';
import { recordAuditEvent } from './audit.js';
import {
  createDatabase,
  createDatabasePool,
  describeDatabaseError,
} from './client.js';
import { memberships, organizations, users } from './schema.js';

export type ProvisionRole = 'ORG_ADMIN' | 'MEMBER';

export interface ProvisionMember {
  /** The identity provider's subject (`sub` claim) for this person. */
  subject: string;
  email: string;
  role: ProvisionRole;
}

export interface ProvisionResult {
  organizationId: string;
  organizationCreated: boolean;
  membershipsGranted: number;
}

/** Thrown for operator input that cannot be applied safely; nothing is written. */
export class ProvisionError extends Error {
  override name = 'ProvisionError';
}

/**
 * Operator provisioning (no self-service onboarding in the MVP, BA BO-05):
 * creates an organization if needed and grants memberships to identity-provider
 * subjects, who are linked on first sign-in. Idempotent and transactional;
 * existing roles are never changed silently. Every change is audited.
 */
export async function provisionOrganization(
  databaseUrl: string,
  organizationName: string,
  members: ProvisionMember[],
): Promise<ProvisionResult> {
  const name = organizationName.trim();
  if (!name) throw new ProvisionError('Organization name is required');
  const pool = createDatabasePool(databaseUrl);
  try {
    return await createDatabase(pool).transaction(async (tx) => {
      const existing = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.name, name))
        .limit(2);
      if (existing.length > 1) {
        throw new ProvisionError(
          'Several organizations have this name; provision by a unique name',
        );
      }
      let organizationId = existing[0]?.id;
      const organizationCreated = organizationId === undefined;
      if (!organizationId) {
        organizationId = (
          await tx
            .insert(organizations)
            .values({ name })
            .returning({ id: organizations.id })
        )[0]!.id;
        await recordAuditEvent(tx, {
          action: 'ORGANIZATION_PROVISIONED',
          organizationId,
          actorUserId: null,
          targetType: 'organization',
          targetId: organizationId,
          metadata: { source: 'provision-cli' },
        });
      }

      let membershipsGranted = 0;
      for (const member of members) {
        await tx
          .insert(users)
          .values({
            authSubject: member.subject,
            email: member.email,
            displayName: null,
          })
          .onConflictDoNothing({ target: users.authSubject });
        const [user] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.authSubject, member.subject));
        const [current] = await tx
          .select({ role: memberships.role })
          .from(memberships)
          .where(
            and(
              eq(memberships.organizationId, organizationId),
              eq(memberships.userId, user!.id),
            ),
          );
        if (current) {
          if (current.role !== member.role) {
            throw new ProvisionError(
              `Subject ${member.subject} is already a ${current.role} of this organization; role changes are not supported`,
            );
          }
          continue;
        }
        await tx.insert(memberships).values({
          organizationId,
          userId: user!.id,
          role: member.role,
        });
        await recordAuditEvent(tx, {
          action: 'MEMBERSHIP_GRANTED',
          organizationId,
          actorUserId: null,
          targetType: 'user',
          targetId: user!.id,
          metadata: { role: member.role, source: 'provision-cli' },
        });
        membershipsGranted += 1;
      }
      return { organizationId, organizationCreated, membershipsGranted };
    });
  } finally {
    await pool.end();
  }
}

/** Parses `subject:email`; the subject may itself contain colons. */
export function parseMember(
  value: string,
  role: ProvisionRole,
): ProvisionMember {
  const separator = value.lastIndexOf(':');
  const subject = value.slice(0, separator).trim();
  const email = value.slice(separator + 1).trim();
  if (separator <= 0 || !subject || !/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new ProvisionError(
      `Invalid member "${value}": expected <subject>:<email>`,
    );
  }
  return { subject, email, role };
}

const USAGE =
  'Usage: provision --organization <name> [--admin <subject>:<email>]... [--member <subject>:<email>]...';

// Operator CLI (all environments): `pnpm db:provision -- --organization ...`,
// or `node node_modules/@cka/database/dist/provision.js ...` in the API image.
if (isMainModule(import.meta.url)) {
  loadEnvFileIfPresent(new URL('../../../.env', import.meta.url));
  let organization: string;
  let members: ProvisionMember[];
  try {
    const { values } = parseArgs({
      options: {
        organization: { type: 'string' },
        admin: { type: 'string', multiple: true, default: [] },
        member: { type: 'string', multiple: true, default: [] },
      },
    });
    if (!values.organization) throw new ProvisionError(USAGE);
    organization = values.organization;
    members = [
      ...values.admin.map((v) => parseMember(v, 'ORG_ADMIN')),
      ...values.member.map((v) => parseMember(v, 'MEMBER')),
    ];
  } catch (error) {
    console.error(error instanceof Error ? error.message : USAGE);
    process.exit(2);
  }
  const { url } = loadDatabaseConfigOrExit();
  try {
    const result = await provisionOrganization(
      url.reveal(),
      organization,
      members,
    );
    console.log(
      `Organization ${result.organizationId} ${result.organizationCreated ? 'created' : 'already existed'}; ${result.membershipsGranted} membership(s) granted`,
    );
  } catch (error) {
    console.error(
      error instanceof ProvisionError
        ? `Provisioning refused: ${error.message}`
        : `Provisioning failed: ${describeDatabaseError(error)}`,
    );
    process.exit(1);
  }
}
