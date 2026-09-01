const js = require('@eslint/js')
const tseslint = require('typescript-eslint')
const prettierRecommended = require('eslint-plugin-prettier/recommended')
const globals = require('globals')

module.exports = [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/update-pkg.js',
      '**/vitest.config.ts',
      'eslint.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierRecommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-interface': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
]
