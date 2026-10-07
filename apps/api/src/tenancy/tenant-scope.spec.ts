import { ESLint } from 'eslint';
import { TenantScope } from './tenant-scope.js';

describe('TenantScope (E1-T05)', () => {
  it('is derived from the server-resolved principal', () => {
    const scope = TenantScope.fromPrincipal({
      userId: 'u',
      organizationId: 'org-a',
      membershipId: 'm',
      role: 'MEMBER',
    });

    expect(scope).toEqual({ organizationId: 'org-a' });
    expect(Object.isFrozen(scope)).toBe(true);
  });

  it('cannot be satisfied by a plain organization ID (type-level)', () => {
    const takesScope = (scope: TenantScope) => scope.organizationId;
    // @ts-expect-error a raw string is not a TenantScope
    takesScope('org-a');
    // @ts-expect-error a client-shaped object is not a TenantScope
    takesScope({ organizationId: 'org-a' });
    expect(takesScope(TenantScope.forSystem('org-a'))).toBe('org-a');
  });
});

describe('tenant-safe repository lint rule (E1-T05)', () => {
  const eslint = new ESLint({
    cwd: new URL('../..', import.meta.url).pathname,
  });
  const lint = async (source: string) => {
    const [result] = await eslint.lintText(source, {
      filePath: 'src/example/example.repository.ts',
    });
    return result!.messages
      .filter((message) => message.ruleId === 'no-restricted-syntax')
      .map((message) => message.line);
  };

  it('rejects lookups and mutations by ID without a tenant scope', async () => {
    const lines = await lint(
      [
        'export class ExampleRepository {',
        '  async findById(id: string) { return id; }',
        '  async deleteById(organizationId: string, id: string) { return organizationId + id; }',
        '}',
      ].join('\n'),
    );

    expect(lines).toEqual([2, 3]);
  });

  it('accepts methods that take the scope first', async () => {
    const lines = await lint(
      [
        'export class ExampleRepository {',
        '  async findById(scope: { organizationId: string }, id: string) {',
        '    return scope.organizationId + id;',
        '  }',
        '}',
      ].join('\n'),
    );

    expect(lines).toEqual([]);
  });
});
