import prettierConfig from 'eslint-config-prettier';
import { flatConfigs as importXConfigs } from 'eslint-plugin-import-x';
import perfectionist from 'eslint-plugin-perfectionist';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const internalPattern = '^@(polygonlabs|maticnetwork|agglayer|0xsequence|0xtrails)/';

export default tseslint.config(
  {
    ignores: ['**/dist', '.claude/**']
  },
  tseslint.configs.base,
  tseslint.configs.eslintRecommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs}'],
    plugins: {
      perfectionist
    },
    rules: {
      'perfectionist/sort-imports': [
        'error',
        {
          type: 'natural',
          internalPattern: [internalPattern],
          groups: [
            'type-import',
            'value-builtin',
            'value-external',
            'type-internal',
            'value-internal',
            ['type-parent', 'type-sibling', 'type-index'],
            ['value-parent', 'value-sibling', 'value-index'],
            'ts-equals-import',
            'unknown'
          ]
        }
      ]
    }
  },
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs}'],
    ...importXConfigs.recommended
  },
  {
    files: ['**/*.{ts,tsx}'],
    ...importXConfigs.typescript
  },
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs}'],
    languageOptions: {
      globals: {
        ...globals.node
      }
    },
    settings: {
      'import/internal-regex': internalPattern
    },
    rules: {
      'import-x/consistent-type-specifier-style': ['error', 'prefer-top-level'],
      'import-x/no-duplicates': ['error'],
      'import-x/no-default-export': 'error',
      'import-x/no-extraneous-dependencies': ['off'],
      'import-x/no-relative-packages': ['error'],
      'import-x/no-unresolved': ['off'],
      'import-x/prefer-default-export': ['off'],
      'no-await-in-loop': 'off',
      'no-param-reassign': 'error',
      'no-underscore-dangle': ['off'],
      'no-useless-escape': 'off'
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    settings: {
      'import-x/resolver': {
        typescript: true
      }
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error'],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  },
  {
    files: [
      '**/*.tsx',
      '**/*.config.{js,ts,mjs}',
      '**/*.config.*.{js,ts,mjs}',
      '**/.lintstagedrc.{js,ts,mjs}',
      '**/worker.{js,ts,mjs}'
    ],
    rules: {
      'import-x/no-default-export': 'off'
    }
  },
  prettierConfig
);
