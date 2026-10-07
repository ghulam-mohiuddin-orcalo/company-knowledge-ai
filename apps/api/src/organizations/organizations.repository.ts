import { Inject, Injectable } from '@nestjs/common';
import { type Database, organizations } from '@cka/database';
import { asc, eq } from 'drizzle-orm';
import { DATABASE } from '../database/database.module.js';

export type OrganizationRecord = typeof organizations.$inferSelect;
export type OrganizationStatus = OrganizationRecord['status'];

/**
 * Organizations are the tenant root (not tenant-owned), so lookup by ID is
 * allowed here; callers must still authorize access through a membership.
 */
@Injectable()
export class OrganizationsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(input: { name: string }): Promise<OrganizationRecord> {
    const [organization] = await this.db
      .insert(organizations)
      .values(input)
      .returning();
    return organization!;
  }

  // eslint-disable-next-line no-restricted-syntax -- tenant root, not tenant-owned; callers authorize via membership.
  async findById(id: string): Promise<OrganizationRecord | undefined> {
    const [organization] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, id));
    return organization;
  }

  async setStatus(id: string, status: OrganizationStatus): Promise<void> {
    await this.db
      .update(organizations)
      .set({ status })
      .where(eq(organizations.id, id));
  }

  /** Platform operations only (all tenants). */
  async listAll(): Promise<OrganizationRecord[]> {
    return this.db
      .select()
      .from(organizations)
      .orderBy(asc(organizations.createdAt), asc(organizations.id));
  }
}
