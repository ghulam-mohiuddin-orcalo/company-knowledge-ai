import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/** Shared TypeScript lint rules for every workspace package. */
export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', '.next/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
);
