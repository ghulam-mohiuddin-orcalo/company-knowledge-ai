// Backend-only database package (schema, migrations, connection helpers). Never import into apps/web.
export * from './schema.js';
export {
  createDatabase,
  createDatabasePool,
  describeDatabaseError,
  pingDatabase,
  type Database,
  type DatabasePool,
} from './client.js';
export { runMigrations } from './migrate.js';
