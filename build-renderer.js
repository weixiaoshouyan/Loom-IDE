const path = require('path');
const esbuild = require(path.join(__dirname, 'node_modules', '.esbuild-lkTzTQ43', 'lib', 'main.js'));

const entryPoint = path.join(__dirname, 'src', 'renderer', 'main.tsx');
const outdir = path.join(__dirname, 'dist', 'renderer', 'assets');

esbuild.build({
  entryPoints: [entryPoint],
  bundle: true,
  outdir,
  format: 'esm',
  loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css', '.ttf': 'file', '.woff': 'file', '.woff2': 'file' },
  define: { 'process.env.NODE_ENV': '"production"' },
  jsx: 'automatic',
  splitting: true,
  minify: false,
  sourcemap: false,
  entryNames: '[name]',
  assetNames: '[name]',
  chunkNames: 'chunk-[hash]',
}).then(() => {
  console.log('Build OK');
}).catch(e => {
  console.error('Build failed:', e.message);
  process.exit(1);
});
