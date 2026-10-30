import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, it, expect, vi } from 'vitest';

const html = readFileSync('qr-generator.html', 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];

async function boot(queueResponse, user = null) {
  const dom = new JSDOM(html, {url: 'http://localhost:5173/qr-generator.html', runScripts: 'outside-only'});
  const win = dom.window;
  win.kioskQueueUser = user;
  if (user) win.localStorage.setItem('sysu.mysql.session', 'SYNTHETIC-STAFF-TOKEN');
  win.setInterval = vi.fn();
  win.setTimeout = vi.fn();
  win.document.addEventListener = vi.fn(); // Do not load CDN Socket.IO in this isolated DOM test.
  win.QRCode = class { static CorrectLevel = {H: 2}; };
  win.fetch = vi.fn(async url => {
    if (url.endsWith('/queue-display') || url.endsWith('/queue-cards')) return queueResponse();
    return {ok: true, json: async () => ({success: true, token: 'SYNTHETIC-QR'})};
  });
  win.eval(script);
  await vi.waitFor(() => expect(win.document.getElementById('queue-status').textContent.trim()).not.toBe('Queue loading...'));
  return {dom, win};
}

describe('R02 anonymous kiosk contract', () => {
  it('uses the public queue projection without initializing a client database SDK', async () => {
    const {dom, win} = await boot(async () => ({ok: true, json: async () => ({success: true,
      data: {queues: {'4W': [{position: 1}]}, truncated: false, asOf: '2026-10-08T00:00:00Z'}})}));
    expect(win.firebase).toBeUndefined();
    expect(win.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/qr/queue-display'),
      expect.objectContaining({signal: expect.anything()}));
    expect(win.document.getElementById('body-4W').textContent).toContain('#001');
    expect(win.document.getElementById('cnt-4W').textContent).toBe('1');
    dom.window.close();
  });

  it('renders only bounded numeric positions and labels a truncated projection', async () => {
    const {dom, win} = await boot(async () => ({ok: true, json: async () => ({success: true,
      data: {queues: {'4W': [{position: 1, driverName: 'PRIVATE DRIVER'}, {position: '<img onerror=alert(1)>'}]},
        truncated: true, asOf: '2026-10-08T00:00:00Z'}})}));
    const body = win.document.getElementById('body-4W');
    expect(body.textContent).toContain('#001');
    expect(body.textContent).not.toContain('PRIVATE DRIVER');
    expect(body.querySelector('img')).toBeNull();
    expect(win.document.getElementById('queue-status').textContent).toMatch(/first 100/i);
    dom.window.close();
  });

  it('shows unavailable status rather than an empty or live queue after a fetch failure', async () => {
    const {dom, win} = await boot(async () => {throw new Error('offline');});
    expect(win.document.getElementById('queue-status')?.textContent).toMatch(/unavailable/i);
    expect(win.document.getElementById('cnt-4W').textContent).toBe('—');
    expect(win.document.getElementById('body-4W').textContent).toMatch(/unavailable/i);
    dom.window.close();
  });
});

describe('W-05 authorized registered-driver cards', () => {
  it('uses a staff token and safely renders name, plate and called status', async () => {
    const user = {getIdToken: vi.fn(async () => 'SYNTHETIC-STAFF-TOKEN')};
    const {dom, win} = await boot(async () => ({ok: true, json: async () => ({success: true,
      data: {queues: {'4W': [{position: 1, driverName: '<img src=x onerror=alert(1)>',
        plateNumber: 'TEST-123', status: 'called'}]}, asOf: '2026-10-09T00:00:00Z'}})}), user);
    expect(user.getIdToken).not.toHaveBeenCalled();
    expect(win.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/qr/queue-cards'),
      expect.objectContaining({headers: {Authorization: 'Bearer SYNTHETIC-STAFF-TOKEN'}}));
    const body = win.document.getElementById('body-4W');
    expect(body.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(body.textContent).toContain('TEST-123');
    expect(body.textContent).toContain('Tinatawag');
    expect(body.querySelector('img')).toBeNull();
    dom.window.close();
  });

  it('renders safe defaults for missing card fields', async () => {
    const {dom, win} = await boot(async () => ({ok: true, json: async () => ({success: true,
      data: {queues: {'4W': [{position: 1}]}, asOf: '2026-10-09T00:00:00Z'}})}),
      {getIdToken: async () => 'staff'});
    expect(win.document.getElementById('body-4W').textContent).toContain('Driver');
    expect(win.document.getElementById('body-4W').textContent).toContain('Plate unavailable');
    dom.window.close();
  });

  it('clears driver details on logout and ignores an older authenticated response', async () => {
    const response = () => ({ok:true,json:async()=>({success:true,data:{queues:{'4W':[
      {position:1,driverName:'STAFF-ONLY-NAME',plateNumber:'TEST'}]},asOf:'2026-10-09T00:00:00Z'}})});
    let calls=0,release;
    const {dom,win}=await boot(async()=>{
      calls++;
      return calls===2 ? new Promise(resolve=>{release=resolve;}) : response();
    },{getIdToken:async()=> 'staff'});
    expect(win.document.getElementById('body-4W').textContent).toContain('STAFF-ONLY-NAME');
    const pending=win.fetchQueue();
    await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
    win.kioskQueueUser=null;
    win.dispatchEvent(new win.Event('kiosk-auth-changed'));
    expect(win.document.getElementById('body-4W').textContent).not.toContain('STAFF-ONLY-NAME');
    release(response());await pending;
    await vi.waitFor(()=>expect(calls).toBe(3));
    await vi.waitFor(()=>expect(win.document.getElementById('body-4W').textContent).toContain('#001'));
    expect(win.document.getElementById('body-4W').textContent).not.toContain('STAFF-ONLY-NAME');
    dom.window.close();
  });
});
