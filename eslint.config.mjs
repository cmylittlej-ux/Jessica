import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Root flat config — covers packages/* and tests/*.
 * apps/web keeps the create-next-app ESLint setup (eslint-config-next).
 */
export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/.next/**', '**/coverage/**', '**/dist/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
);
