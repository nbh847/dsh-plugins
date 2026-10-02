import type { UserConfig } from 'tsdown'

export default {
  entry: { index: 'src/index.ts' }, outDir: 'lib', format: 'esm', platform: 'node',
  target: 'es2024', fixedExtension: false, dts: false,
} satisfies UserConfig
