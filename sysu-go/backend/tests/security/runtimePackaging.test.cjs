const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
for (const name of ['Dockerfile', 'backend/Dockerfile']) {
  test(name + ' uses verified Node runtime and excludes development dependencies', () => {
    const content = fs.readFileSync(path.join(root, name), 'utf8');
    assert.match(content, /^FROM node:24-slim$/m);
    assert.match(content, /^RUN npm ci --omit=dev$/m);
    assert.match(content, /^USER node$/m);
    assert.match(content, /^ENV NODE_ENV=production \\\r?\n\s+PORT=8080$/m);
    assert.match(content, /\/api\/health/);
    assert.doesNotMatch(content, /localhost:3001/);
  });
}
test('compose uses backend env and binds the API to host loopback by default', () => {
  const compose = fs.readFileSync(path.join(root, 'compose.yaml'), 'utf8');
  assert.match(compose, /env_file:\s*\n\s+- backend\/\.env/);
  assert.match(compose, /127\.0\.0\.1:\$\{HOST_PORT:-8080\}:\$\{PORT:-8080\}/);
  assert.doesNotMatch(compose, /FIREBASE|FIRESTORE/i);
});
test('both Docker contexts include the runtime constants module', () => {
  for (const [file, directory] of [['.dockerignore', 'backend/'], ['backend/.dockerignore', '']]) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(content.split(/\r?\n/).includes(`!${directory}constants/`));
    assert.ok(content.split(/\r?\n/).includes(`!${directory}constants/**/*.js`));
  }
  for (const file of ['backend/middleware/socketAuth.js', 'backend/services/driverActionPolicy.js'])
    assert.match(fs.readFileSync(path.join(root, file), 'utf8'), /constants\/driverActionEvents/);
});
test('container environment example has no credential value', () => {
  const example = fs.readFileSync(path.join(root, '.env.container.example'), 'utf8');
  assert.match(example, /^DB_HOST=127\.0\.0\.1$/m);
  assert.match(example, /^DB_NAME=sysu_fleet_app$/m);
  assert.doesNotMatch(example, /FIREBASE|FIRESTORE/i);
  assert.doesNotMatch(example, /PRIVATE KEY|AIza[\w-]{20,}/);
});
test('backend declares the verified Node runtime for non-container hosting', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'backend/package.json'), 'utf8'));
  assert.equal(config.engines?.node, '24.x');
});

test('all Go HTTP API routes have a global limiter before body parsing and auth-specific limits', () => {
  const server = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8');
  const limiter = server.indexOf('app.use("/api", createApiRateLimiter(apiRateLimitConfig));');
  const parser = server.indexOf('app.use(express.json({ limit: "10mb" }));');
  const authLimiter = server.indexOf('app.use("/api/auth/mysql", rateLimit({');
  assert.ok(limiter >= 0 && limiter < parser, 'the API limiter must run before body parsing');
  assert.ok(limiter < authLimiter, 'the global API limiter must also cover auth routes');
});
