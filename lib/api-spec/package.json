{
  "name": "@workspace/api-spec",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "codegen": "orval --config ./orval.config.ts && echo 'export * from \"./generated/api\";' > ../api-zod/src/index.ts && pnpm -w run typecheck:libs"
  },
  "devDependencies": {
    "orval": "^8.5.2"
  }
}
