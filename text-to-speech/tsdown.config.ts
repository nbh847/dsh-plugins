import type { UserConfig } from 'tsdown'

const config: UserConfig = {
  name: 'dsh-plugin-text-to-speech',
  entry: {
    index: 'src/index.ts',
  },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

export default config
