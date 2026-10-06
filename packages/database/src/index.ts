// Backend-only database package (schema, migrations, connection helpers). Never import into apps/web.
export * from './schema.js';
export {
  createDatabasePool,
  describeDatabaseError,
  pingDatabase,
  type DatabasePool,
} from './client.js';
