import './check-node.mjs';
// Set this before importing Vite: the desktop terminal can inherit development mode.
process.env.NODE_ENV = 'production';
const { build } = await import('vite');
await build({ mode: 'production' });

// Static seed pages, sitemap, robots and homepage structured data are written
// after Vite so the hashed bundle is already in place.
const { buildPages } = await import('./build-pages.mjs');
await buildPages();
