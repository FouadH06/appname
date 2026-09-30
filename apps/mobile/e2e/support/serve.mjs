// Static server for the app's web export with SPA fallback (every unknown path → index.html), so deep
// links like /bookings/{id} load directly — as universal links do on a phone. Test-only.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = join(import.meta.dirname, '../../dist');
const port = Number(process.env.PORT ?? 8081);
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.css': 'text/css',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
};

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(
    /^([/\\])+/,
    '',
  );
  let file = join(root, path);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory())
    file = join(root, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () =>
  process.stdout.write(`app web build on http://127.0.0.1:${port}\n`),
);
