import nest from '@cka/eslint-config/nest';

export default [
  ...nest,
  {
    // Tenant-safe repository convention (E1-T05): lookups/mutations by ID must take
    // `scope: TenantScope` first, so tenant-owned rows are never fetched by ID alone.
    files: ['src/**/*.repository.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MethodDefinition[key.name=/ById$|ByIds$/] > FunctionExpression:not([params.0.name='scope'])",
          message:
            'Tenant-owned repository methods by ID must take `scope: TenantScope` as the first parameter. Only tenant-root/global repositories may opt out, with an eslint-disable comment explaining why.',
        },
      ],
    },
  },
];
