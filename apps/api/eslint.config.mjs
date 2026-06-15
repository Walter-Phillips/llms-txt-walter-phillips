// @ts-check
import base from "@profound-takehome/config/eslint/base";
import jsdoc from "eslint-plugin-jsdoc";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

export default tseslint.config(
  base,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    plugins: { jsdoc, unicorn },
    rules: {
      // Documentation
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            MethodDefinition: true,
            ClassDeclaration: true,
            ArrowFunctionExpression: false,
            FunctionExpression: false,
          },
          contexts: [
            "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression",
          ],
        },
      ],
      "jsdoc/require-description": ["error", { descriptionStyle: "body" }],
      "jsdoc/require-param": "error",
      "jsdoc/require-param-description": "error",
      "jsdoc/require-param-type": "off",
      "jsdoc/require-returns": "error",
      "jsdoc/require-returns-description": "error",
      "jsdoc/require-returns-type": "off",
      "jsdoc/require-throws": "error",
      "jsdoc/check-param-names": "error",
      "jsdoc/check-tag-names": "error",
      "jsdoc/no-blank-blocks": "error",

      // Size limits
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": [
        "error",
        { max: 50, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      "max-depth": ["error", 4],
      "max-params": ["error", 4],
      complexity: ["error", 10],

      // Naming
      "@typescript-eslint/naming-convention": [
        "error",
        { selector: "variable", format: ["camelCase", "UPPER_CASE"] },
        { selector: "function", format: ["camelCase"] },
        { selector: "typeLike", format: ["PascalCase"] },
        {
          selector: "interface",
          format: ["PascalCase"],
          custom: { regex: "^I[A-Z]", match: false },
        },
        { selector: "enumMember", format: ["UPPER_CASE"] },
      ],

      // TypeScript strictness
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/prefer-as-const": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      "@typescript-eslint/prefer-optional-chain": "error",

      // Imports & hygiene
      "unicorn/prefer-module": "error",
      "no-duplicate-imports": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-debugger": "error",
      eqeqeq: ["error", "always"],
      "prefer-const": "error",
      "no-var": "error",
      "object-shorthand": "error",
      "unicorn/no-lonely-if": "error",
      "unicorn/prevent-abbreviations": [
        "warn",
        {
          allowList: {
            req: true,
            res: true,
            err: true,
            ctx: true,
            fn: true,
            db: true,
            env: true,
            id: true,
            idx: true,
            i: true,
            j: true,
          },
        },
      ],
      "unicorn/prefer-ternary": "warn",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**/*.ts"],
    rules: {
      "max-lines": ["error", { max: 600, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": "off",
      "jsdoc/require-jsdoc": "off",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["scripts/**/*.ts", "*.config.ts", "*.config.mjs"],
    rules: {
      "no-console": "off",
      "jsdoc/require-jsdoc": "off",
    },
  },
);
