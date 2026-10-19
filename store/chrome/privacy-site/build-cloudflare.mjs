import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Pages advanced mode serves the same HTML when the connector cannot upload
// static assets with a separate short-lived upload token.
const html = await readFile(new URL('./dist/index.html', import.meta.url), 'utf8');
const worker = `const html = ${JSON.stringify(html)};

export default {
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path !== '/' && path !== '/index.html') {
      return new Response('Not found', { status: 404 });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD' }
      });
    }
    return new Response(request.method === 'HEAD' ? null : html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
      }
    });
  }
};
`;
await mkdir(new URL('./cloudflare/', import.meta.url), { recursive: true });
await writeFile(new URL('./cloudflare/_worker.js', import.meta.url), worker);
