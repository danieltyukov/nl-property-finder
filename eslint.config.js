import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.claude/**', '**/dist/**', '**/node_modules/**', 'docs/design/proto3d/**', '**/*.min.js', 'site/public/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
