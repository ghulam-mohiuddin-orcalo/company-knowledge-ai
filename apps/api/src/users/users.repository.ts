import { Inject, Injectable } from '@nestjs/common';
import { type Database, recordAuditEvent, users } from '@cka/database';
import { getLogContext } from '@cka/observability';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../database/database.module.js';

export type UserRecord = typeof users.$inferSelect;

/**
 * Users are global identities, not tenant-owned: a user may belong to several
 * organizations. Tenant access always goes through memberships.
 */
@Injectable()
export class UsersRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findByAuthSubject(
    authSubject: string,
  ): Promise<UserRecord | undefined> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.authSubject, authSubject));
    return user;
  }

  /**
   * Inserts the user unless the subject already exists (concurrent first
   * sign-ins); a new user is audited as USER_PROVISIONED.
   */
  async insertIfAbsent(input: {
    authSubject: string;
    email: string;
    displayName: string | null;
  }): Promise<boolean> {
    const inserted = await this.db
      .insert(users)
      .values(input)
      .onConflictDoNothing({ target: users.authSubject })
      .returning({ id: users.id });
    if (inserted[0]) {
      await recordAuditEvent(this.db, {
        action: 'USER_PROVISIONED',
        organizationId: null,
        actorUserId: inserted[0].id,
        targetType: 'user',
        targetId: inserted[0].id,
        requestId: getLogContext().requestId,
      });
    }
    return inserted.length > 0;
  }

  async updateProfile(
    userId: string,
    profile: { email: string; displayName: string | null },
  ): Promise<UserRecord> {
    const [user] = await this.db
      .update(users)
      .set(profile)
      .where(eq(users.id, userId))
      .returning();
    return user!;
  }
}
