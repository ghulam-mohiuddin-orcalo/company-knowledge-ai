// Shared configuration primitives: validated, typed environment configuration
// for the backend processes (api, worker). Never import this into apps/web.
export {
  ConfigValidationError,
  loadConfig,
  loadConfigOrExit,
  loadDatabaseConfig,
  loadDatabaseConfigOrExit,
  loadEnvFileIfPresent,
  type AppConfig,
  type DatabaseConfig,
} from './load-config.js';
export { Secret } from './secret.js';
