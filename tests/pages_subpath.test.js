/**
 * GitHub Pages serves the app under a sub-path (e.g. /nutriplanner/).
 * Asset URLs must be relative so fetch/css/modules resolve under that prefix.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return fs.readFileSync(path.join(appRoot, rel), 'utf8');
}

test('index.html and app entry use relative asset URLs (no root-absolute paths)', () => {
  const html = read('index.html');
  assert.match(html, /href="styles\/app\.css"/);
  assert.match(html, /src="src\/app\.js"/);
  assert.doesNotMatch(html, /href="\/[^"]+"/);
  assert.doesNotMatch(html, /src="\/[^"]+"/);

  const app = read('src/app.js');
  assert.match(app, /loadJson\('data\/foods\.json'\)/);
  assert.match(app, /loadJson\('data\/recipes\.json'\)/);
  assert.doesNotMatch(app, /fetch\(['"]\//);
  assert.doesNotMatch(app, /href=['"]\//);
});

test('HTTP serve under /nutriplanner/ loads index, css, module and foods.json', async () => {
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  };
  const prefix = '/nutriplanner';
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (!urlPath.startsWith(`${prefix}/`) && urlPath !== prefix) {
      res.writeHead(404);
      res.end('not under prefix');
      return;
    }
    let rel = urlPath.slice(prefix.length);
    if (rel === '' || rel === '/') rel = '/index.html';
    const filePath = path.join(appRoot, rel.replace(/^\//, ''));
    if (!filePath.startsWith(appRoot) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('missing');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}${prefix}`;

  try {
    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200, 'index');
    const indexHtml = await index.text();
    assert.match(indexHtml, /NutriPlanner/);

    const css = await fetch(`${base}/styles/app.css`);
    assert.equal(css.status, 200, 'css');

    const mod = await fetch(`${base}/src/app.js`);
    assert.equal(mod.status, 200, 'app module');

    // Relative resolution as the browser does from /nutriplanner/ or /nutriplanner/index.html
    const foodsFromDir = await fetch(new URL('data/foods.json', `${base}/`).href);
    assert.equal(foodsFromDir.status, 200, 'foods from /nutriplanner/');
    const foodsJson = await foodsFromDir.json();
    assert.ok(Array.isArray(foodsJson) && foodsJson.length > 100);

    const foodsFromFile = await fetch(new URL('data/foods.json', `${base}/index.html`).href);
    assert.equal(foodsFromFile.status, 200, 'foods from index.html URL');

    const recipes = await fetch(new URL('data/recipes.json', `${base}/`).href);
    assert.equal(recipes.status, 200, 'recipes');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
