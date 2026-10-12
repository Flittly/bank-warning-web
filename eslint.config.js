import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // 下划线开头的形参/变量表示「有意不使用」——占位、对齐外部签名、或解构时剔除某字段，
      // 属于设计意图而不是冗余代码，不该被当成待清理项。
      // ignoreRestSiblings 让 `const { confirmPassword: _pwd, ...rest } = values` 这种
      // 「把某个字段摘出去再传剩余字段」的写法不被误报（这里的 _pwd 是承重的，删掉会把
      // confirmPassword 一起发给后端）。
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
    },
  },
])
