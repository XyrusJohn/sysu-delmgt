const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');

for (const file of ['frontend/src/pages/dashboard.js', 'frontend/src/api/socket.js']) {
  test(`R05: release source parses: ${file}`, () => {
    const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  });
}

test('R06: backend declares its validation runtime dependency', () => {
  const pkg = require(path.join(root, 'backend/package.json'));
  assert.ok(pkg.dependencies.zod, 'backend imports zod but does not declare it');
});

test('R06: frontend owns its component and test dependencies', () => {
  const pkg = require(path.join(root, 'frontend/package.json'));
  for (const dependency of ['react', 'react-dom', 'prop-types']) {
    assert.ok(pkg.dependencies[dependency], `missing runtime dependency: ${dependency}`);
  }
  for (const dependency of ['vitest', 'jsdom', '@testing-library/react', '@testing-library/jest-dom']) {
    assert.ok(pkg.devDependencies[dependency], `missing test dependency: ${dependency}`);
  }
});
