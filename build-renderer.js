const path = require('path');
const fs = require('fs');
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
  // Generate index.html
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Loom IDE</title>
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https:; font-src 'self' https: data:; connect-src *; worker-src blob: 'self'; img-src 'self' data: blob:;" />
  <script type="module" crossorigin src="./assets/main.js"></script>
  <link rel="stylesheet" crossorigin href="./assets/main.css">
</head>
<body>
  <div id="root"></div>
</body>
</html>`;
  const htmlPath = path.join(__dirname, 'dist', 'renderer', 'index.html');
  fs.writeFileSync(htmlPath, html);
  console.log('Generated index.html');
}).catch(e => {
  console.error('Build failed:', e.message);
  process.exit(1);
});
