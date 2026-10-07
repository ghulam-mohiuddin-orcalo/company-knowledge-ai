import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * True when the module is the process entry point. Compares real paths: in
 * deployed bundles packages are reached through symlinks (pnpm), where
 * `process.argv[1]` keeps the link but `import.meta.url` is resolved.
 */
export function isMainModule(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
