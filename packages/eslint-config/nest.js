import globals from 'globals';
import tseslint from 'typescript-eslint';
import base from './base.js';

/** Lint rules for NestJS applications (api, worker). */
export default tseslint.config(...base, {
  languageOptions: {
    globals: { ...globals.node },
  },
});
