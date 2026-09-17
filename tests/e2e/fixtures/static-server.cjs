// Minimal static file server with no build step of any kind — used only by
// static-hosting.spec.js to verify the game also runs the way README documents as the Live
// Server alternative to `pnpm dev`. Deliberately not vite: a bare module specifier (anything
// imported as `from 'some-package'` instead of a relative path or an index.html import-map
// entry) resolves fine under Vite's dev server, which rewrites those, but the browser's native
// module loader rejects it outright with no bundler in front of it.
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = process.argv[2] || '.';
const port = Number(process.argv[3] || 5511);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.bin': 'application/octet-stream',
  '.map': 'application/json', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(root, urlPath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found: ' + urlPath); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});
server.listen(port, '127.0.0.1', () => {
  // Parent process (static-hosting.spec.js) waits for this exact line on stdout.
  console.log(`static-server-ready:${port}`);
});
