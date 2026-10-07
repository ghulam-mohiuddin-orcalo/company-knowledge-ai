import nest from '@cka/eslint-config/nest';

export default [
  ...nest,
  { ignores: ['test-results/**', 'playwright-report/**'] },
];
