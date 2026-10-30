import {readFileSync, existsSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {test, expect, vi} from 'vitest';

async function boot(query, response) {
  const html = readFileSync(existsSync('scan-result.html') ? 'scan-result.html' : 'public/scan-result.html', 'utf8');
  const dom = new JSDOM(html, {url: 'http://localhost:5173/scan-result.html' + query, runScripts: 'outside-only'});
  const fetcher = vi.fn(async () => response);
  if (html.includes('src="/src/pages/scanResult.js"')) {
    const modulePath = './scanResult.js';
    const {mountScanResult} = await import(/* @vite-ignore */ modulePath);
    await mountScanResult({document: dom.window.document, search: dom.window.location.search,
      baseUrl: 'http://127.0.0.1:3000', fetcher});
  } else {
    dom.window.fetch = fetcher;
    dom.window.eval([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1]);
    for (let i = 0; i < 8; i++) await Promise.resolve();
  }
  return {dom, document: dom.window.document, fetcher};
}

test('R11/R32 verification uses the configured origin and does not claim queue admission', async () => {
  const {dom, document, fetcher} = await boot('?token=SYNTHETIC', {ok: true});
  expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:3000/api/qr/verify?token=SYNTHETIC', expect.objectContaining({method: 'GET'}));
  expect(document.querySelector('.success-title').textContent).toMatch(/verified/i);
  expect(document.querySelector('.success-sub').textContent).toMatch(/authenticated.*app/i);
  expect(document.querySelector('.success-sub').textContent).not.toMatch(/proceed.*loading/i);
  expect(document.getElementById('verified-token').textContent).not.toContain('SYNTHETIC');
  dom.window.close();
});
test('R11 missing QR token renders an error without network access', async () => {
  const {dom, document, fetcher} = await boot('', {ok: true});
  expect(fetcher).not.toHaveBeenCalled();
  expect(document.getElementById('state-error').classList.contains('active')).toBe(true);
  dom.window.close();
});
test('R11 expired QR cannot show a successful admission', async () => {
  const {dom, document} = await boot('?token=SYNTHETIC', {ok: false, status: 410});
  expect(document.getElementById('err-title').textContent).toMatch(/expired/i);
  expect(document.getElementById('state-success').classList.contains('active')).toBe(false);
  dom.window.close();
});
