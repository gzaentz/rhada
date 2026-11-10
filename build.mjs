import { build } from 'esbuild';

await build({
  entryPoints: {
    background: 'src/background.js',
    content: 'src/content.js',
    options: 'src/options.js',
  },
  outdir: 'extension/dist',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome123',
  minify: true,
  logLevel: 'info',
});
