import React from 'react';

// File icon definitions: extension -> { color, label }
const fileIcons: Record<string, { color: string; label?: string }> = {
  // JavaScript/TypeScript
  ts: { color: '#3178c6', label: 'TS' },
  tsx: { color: '#3178c6', label: 'TX' },
  js: { color: '#f7df1e', label: 'JS' },
  jsx: { color: '#61dafb', label: 'JX' },
  mjs: { color: '#f7df1e', label: 'MJ' },
  cjs: { color: '#f7df1e', label: 'CJ' },
  // Web
  html: { color: '#e34c26', label: 'H' },
  htm: { color: '#e34c26' },
  css: { color: '#563d7c', label: 'C' },
  scss: { color: '#cf649a', label: 'SC' },
  sass: { color: '#cf649a' },
  less: { color: '#1d365d', label: 'L' },
  // Data
  json: { color: '#f7df1e', label: '{}' },
  jsonc: { color: '#f7df1e' },
  yaml: { color: '#cb171e', label: 'YM' },
  yml: { color: '#cb171e' },
  toml: { color: '#9c4121', label: 'T' },
  xml: { color: '#0060ac', label: 'X' },
  csv: { color: '#217346', label: 'CV' },
  // Docs
  md: { color: '#519aba', label: 'MD' },
  mdx: { color: '#519aba' },
  txt: { color: '#89b4ac' },
  pdf: { color: '#eb3223', label: 'PD' },
  // Config
  env: { color: '#ecd53f', label: '.e' },
  gitignore: { color: '#f34f29', label: 'GI' },
  dockerignore: { color: '#0db7ed' },
  editorconfig: { color: '#fff1f2' },
  // Shell
  sh: { color: '#89e051', label: '$_' },
  bash: { color: '#89e051' },
  zsh: { color: '#89e051' },
  ps1: { color: '#012456' },
  bat: { color: '#c1f12e' },
  // Images
  png: { color: '#a855f7', label: 'IM' },
  jpg: { color: '#a855f7' },
  jpeg: { color: '#a855f7' },
  gif: { color: '#a855f7' },
  svg: { color: '#ffb13b', label: 'SV' },
  ico: { color: '#ffb13b' },
  webp: { color: '#a855f7' },
  // Fonts
  woff: { color: '#f7df1e' },
  woff2: { color: '#f7df1e' },
  ttf: { color: '#f7df1e' },
  otf: { color: '#f7df1e' },
  eot: { color: '#f7df1e' },
  // Languages
  py: { color: '#3572A5', label: 'PY' },
  go: { color: '#00ADD8', label: 'GO' },
  rs: { color: '#dea584', label: 'RS' },
  java: { color: '#b07219', label: 'JV' },
  rb: { color: '#cc342d', label: 'RB' },
  php: { color: '#4F5D95', label: 'PH' },
  c: { color: '#555555', label: 'C' },
  cpp: { color: '#f34b7d', label: 'C+' },
  h: { color: '#555555' },
  hpp: { color: '#f34b7d' },
  cs: { color: '#68217a', label: 'CS' },
  swift: { color: '#f05138' },
  kt: { color: '#A97BFF', label: 'KT' },
  dart: { color: '#00B4AB' },
  lua: { color: '#000080', label: 'LU' },
  // Build/Config
  lock: { color: '#6a9955' },
  makefile: { color: '#6d8086' },
  dockerfile: { color: '#0db7ed', label: 'DK' },
  cmake: { color: '#064F8C' },
  // Media
  mp3: { color: '#f57c00' },
  mp4: { color: '#f57c00' },
  wav: { color: '#f57c00' },
  avi: { color: '#f57c00' },
  // Archives
  zip: { color: '#a855f7', label: 'ZP' },
  tar: { color: '#a855f7' },
  gz: { color: '#a855f7' },
  rar: { color: '#a855f7' },
  // Database
  sql: { color: '#e38c00', label: 'SQ' },
  db: { color: '#e38c00' },
  sqlite: { color: '#e38c00' },
  // Log
  log: { color: '#6a9955' },
  // Test
  test: { color: '#c21325' },
  spec: { color: '#c21325' },
  // Templates
  vue: { color: '#42b883', label: 'V' },
  svelte: { color: '#ff3e00', label: 'SV' },
  astro: { color: '#ff5d01' },
  // Misc
  wasm: { color: '#654ff0' },
  graphql: { color: '#e535ab', label: 'GQ' },
  gql: { color: '#e535ab' },
};

// Special filenames
const specialFiles: Record<string, { color: string; label?: string }> = {
  'dockerfile': { color: '#0db7ed', label: 'DK' },
  'makefile': { color: '#6d8086', label: 'MK' },
  '.gitignore': { color: '#f34f29', label: 'GI' },
  '.dockerignore': { color: '#0db7ed' },
  '.env': { color: '#ecd53f', label: '.e' },
  '.env.local': { color: '#ecd53f' },
  '.eslintrc': { color: '#4b32c3' },
  '.prettierrc': { color: '#c596c7' },
  '.babelrc': { color: '#f5da55' },
  'tsconfig.json': { color: '#3178c6' },
  'package.json': { color: '#f7df1e', label: 'NP' },
  'package-lock.json': { color: '#6a9955' },
  'yarn.lock': { color: '#2c8ebb' },
  'readme.md': { color: '#519aba', label: 'RD' },
  'license': { color: '#d0bf41' },
  '.editorconfig': { color: '#fff1f2' },
};

export function getFileIcon(filename: string, isDir: boolean, expanded?: boolean): { color: string; svg: JSX.Element } {
  if (isDir) {
    if (expanded) {
      return {
        color: '#dcb67a',
        svg: <svg viewBox="0 0 16 16" fill="#dcb67a"><path d="M1 4.5A1.5 1.5 0 012.5 3h3.146a.5.5 0 01.354.146L7.207 4.354a.5.5 0 00.354.146H13.5A1.5 1.5 0 0115 6v.5H1.5A.5.5 0 001 7v5.5A1.5 1.5 0 002.5 14h11a1.5 1.5 0 001.5-1.5V5.5a.5.5 0 00-.5-.5h-13A.5.5 0 011 4.5z"/></svg>,
      };
    }
    return {
      color: '#dcb67a',
      svg: <svg viewBox="0 0 16 16" fill="#dcb67a"><path d="M1.5 3A1.5 1.5 0 013 1.5h3.146a.5.5 0 01.354.146L7.707 2.854a.5.5 0 00.354.146H13A1.5 1.5 0 0114.5 4.5v8A1.5 1.5 0 0113 14H3A1.5 1.5 0 011.5 12.5V3z"/></svg>,
    };
  }

  const lowerName = filename.toLowerCase();
  const ext = lowerName.split('.').pop() || '';
  
  // Check special filenames first
  const special = specialFiles[lowerName];
  if (special) {
    return makeFileIcon(special.color, special.label);
  }
  
  // Check extension
  const iconDef = fileIcons[ext];
  if (iconDef) {
    return makeFileIcon(iconDef.color, iconDef.label);
  }
  
  // Default file icon
  return makeFileIcon('#8c8c8c');
}

function makeFileIcon(color: string, label?: string): { color: string; svg: JSX.Element } {
  return {
    color,
    svg: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        <path d="M3 1.5H2a1 1 0 00-1 1v11a1 1 0 001 1h12a1 1 0 001-1V5.5L10 1.5H3z" fill="none" stroke={color} strokeWidth="0.8" opacity="0.7" />
        <path d="M10 1.5V5a.5.5 0 00.5.5H15" fill="none" stroke={color} strokeWidth="0.8" opacity="0.7" />
        {label && (
          <text x="8" y="11.5" textAnchor="middle" fill={color} fontSize="4.5" fontWeight="700" fontFamily="monospace">
            {label}
          </text>
        )}
      </svg>
    ),
  };
}
