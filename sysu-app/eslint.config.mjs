import js from '@eslint/js';
import globals from 'globals';

export default [
  {ignores:['**/node_modules/**','**/dist/**','.tools/**','**/__snapshots__/**']},
  {files:['backend/src/**/*.js'],
    languageOptions:{sourceType:'commonjs',globals:globals.node},
    rules:{...js.configs.recommended.rules,'no-unused-vars':['warn',{argsIgnorePattern:'^_',caughtErrors:'none'}]}},
  {files:['frontend/src/**/*.{js,jsx}'],
    languageOptions:{sourceType:'module',parserOptions:{ecmaFeatures:{jsx:true}},
      globals:{...globals.browser,...globals.vitest,L:'readonly',XLSX:'readonly',QRCode:'readonly'}},
    rules:{...js.configs.recommended.rules,'no-unused-vars':['warn',{argsIgnorePattern:'^_',caughtErrors:'none'}]}},
];
