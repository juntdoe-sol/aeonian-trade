import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Ignore patterns (e.g., ignore the 'dist' folder)
  {
    ignores: ['**/*.d.ts', 'dist/**'],
  },
  // Base JavaScript recommended rules
  js.configs.recommended,
  // TypeScript recommended rules (targets .ts and .tsx files).
  // Non-type-checked on purpose: `recommendedTypeChecked` + `projectService` makes ESLint
  // build a whole-project TypeScript program, which OOMs on large projects. `tsc`
  // (the check-types script) is the type-correctness gate instead.
  tseslint.configs.recommended,
  // Custom configuration for React and TypeScript files
  {
    files: ['**/*.ts', '**/*.tsx'], // Lint all .ts and .tsx files
    languageOptions: {
      globals: {
        ...globals.browser, // Add browser globals (e.g., window, document)
        React: 'readonly', // React 17+ JSX transform doesn't require React import
      },
      ecmaVersion: 2020, // Support modern ECMAScript features
    },
    plugins: {
      'react-hooks': reactHooks, // Rules for React hooks
      'react-refresh': reactRefresh, // Ensure React Refresh compatibility
    },
    rules: {
      // React Hooks: classic rules only. eslint-plugin-react-hooks v6+ `recommended` also enables
      // the React-Compiler rule family (static-components, immutability, refs, purity, etc.), whose
      // per-file analysis dominated lint on large projects (~95% of CastLink's lint, ~120s on the
      // container). This template does NOT enable the React Compiler, so those rules are forward-
      // looking enforcement for an unused compiler. Keep only the two cheap, always-valuable ones.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // React Refresh rule to enforce component exports
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Treat unused variables as warnings instead of errors
      '@typescript-eslint/no-unused-vars': 'warn',
      // Treat 'any' type as a warning instead of an error
      '@typescript-eslint/no-explicit-any': 'warn',
      // Type-aware rules removed (they need a full TS program → OOM). They were all 'warn'
      // and lint runs with --quiet, so they emitted nothing enforceable anyway.
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'prefer-const': 'warn',
      'no-console': 'warn',
      'no-empty': 'warn',
      'no-case-declarations': 'warn',
      'no-fallthrough': 'warn',
      'no-extra-boolean-cast': 'warn',
      'no-useless-escape': 'warn',

      // Off for TS: without parser services core no-undef false-positives on type-only DOM
      // globals (RequestInit, BiquadFilterType, ...); tsc (TS2304) catches real undefined names.
      'no-undef': 'off',
    },
  },
);
