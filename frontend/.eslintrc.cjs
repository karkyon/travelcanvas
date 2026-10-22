module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    // [Gate G2] DEP-1 typescript-eslint 8 へ更新。v8 は catch の変数も未使用として数えるため、以前(v6)と同じ判定にする。
    // 型定義の拡張(interface ImportMeta 等の宣言の結合)は使っていなくても残す
    '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }],
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
  },
}
