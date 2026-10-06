import { Inject, Injectable } from '@nestjs/common';
import { type Database, users } from '@cka/database';
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

  /** Inserts the user unless the subject already exists (concurrent first sign-ins). */
  async insertIfAbsent(input: {
    authSubject: string;
    email: string;
    displayName: string | null;
  }): Promise<void> {
    await this.db
      .insert(users)
      .values(input)
      .onConflictDoNothing({ target: users.authSubject });
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
