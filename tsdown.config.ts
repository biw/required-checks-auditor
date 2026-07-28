import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    clean: true,
    deps: {
      alwaysBundle: () => true,
      onlyBundle: false,
    },
    dts: false,
    entry: ['src/index.ts'],
    format: 'esm',
    outDir: 'dist',
    outExtensions: () => ({ js: '.js' }),
    platform: 'node',
    sourcemap: false,
    target: 'node24',
  },
  {
    // Separate builds avoid a shared chunk; both Action and CLI stay independently executable.
    clean: false,
    deps: {
      alwaysBundle: () => true,
      onlyBundle: false,
    },
    dts: false,
    entry: ['src/cli.ts'],
    format: 'esm',
    outDir: 'dist',
    outExtensions: () => ({ js: '.js' }),
    platform: 'node',
    sourcemap: false,
    target: 'node24',
  },
])
