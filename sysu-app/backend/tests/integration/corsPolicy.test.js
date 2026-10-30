const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const express = require('express');
const serverPath = require.resolve('../../src/server.js');
const source = fs.readFileSync(serverPath, 'utf8');
const corsRegistration = 'app.use(require("./middleware/corsPolicy")(allowedOrigins));';
const corsSource = source.slice(source.indexOf('const allowedOrigins ='), source.indexOf(corsRegistration) + corsRegistration.length);
async function request(origin, method = 'GET') {
  const app = express();
  vm.runInNewContext(corsSource, {app, runtimeConfig: {allowedOrigins: ['https://staging.example.invalid']}, require: createRequire(serverPath)});
  app.get('/probe', (_req, res) => res.json({ok: true}));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {return await fetch(`http://127.0.0.1:${server.address().port}/probe`, {method,
    headers: {Origin: origin, 'Access-Control-Request-Method': 'GET'}});}
  finally {await new Promise(resolve => server.close(resolve));}
}
test('R20 configured origin preflight returns exact credentials policy and Vary Origin', async () => {
  const response = await request('https://staging.example.invalid', 'OPTIONS');
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://staging.example.invalid');
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.match(response.headers.get('vary'), /Origin/i);
});
test('R20 disallowed origins get explicit rejection without CORS grant', async () => {
  const response = await request('https://untrusted.example.invalid');
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});
