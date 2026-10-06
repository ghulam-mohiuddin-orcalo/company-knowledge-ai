import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// Source of truth for the database schema. Changes must go through a generated,
// reviewed migration (`pnpm db:generate`); schema push/auto-sync is never used.

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const organizationStatus = pgEnum('organization_status', [
  'ACTIVE',
  'SUSPENDED',
]);

// Tenant-scoped roles. Platform administration is not an organization membership.
export const membershipRole = pgEnum('membership_role', [
  'MEMBER',
  'ORG_ADMIN',
]);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  status: organizationStatus('status').notNull().default('ACTIVE'),
  ...timestamps,
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  authSubject: text('auth_subject').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  ...timestamps,
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: membershipRole('role').notNull(),
    ...timestamps,
  },
  (table) => [
    unique('memberships_organization_id_user_id_key').on(
      table.organizationId,
      table.userId,
    ),
    index('memberships_user_id_organization_id_idx').on(
      table.userId,
      table.organizationId,
    ),
    index('memberships_organization_id_role_idx').on(
      table.organizationId,
      table.role,
    ),
  ],
);
