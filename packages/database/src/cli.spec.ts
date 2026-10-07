import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMainModule } from './cli.js';

describe('isMainModule', () => {
  const originalEntry = process.argv[1];
  let dir: string;
  let real: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cka-cli-'));
    real = join(dir, 'migrate.js');
    writeFileSync(real, '');
  });

  afterEach(() => {
    process.argv[1] = originalEntry!;
    rmSync(dir, { recursive: true, force: true });
  });

  it('recognises the entry point when started through a symlink (deployed bundles)', () => {
    const link = join(dir, 'linked.js');
    symlinkSync(real, link);
    process.argv[1] = link;

    expect(isMainModule(pathToFileURL(real).href)).toBe(true);
  });

  it('is false for an imported module', () => {
    process.argv[1] = join(dir, 'other.js');
    writeFileSync(process.argv[1], '');

    expect(isMainModule(pathToFileURL(real).href)).toBe(false);
  });
});
