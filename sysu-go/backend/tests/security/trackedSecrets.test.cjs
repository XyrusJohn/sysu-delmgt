const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
test('tracked source and configuration contain no embedded PEM private keys', () => {
  const files = cp.execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean);
  const exposed = files.filter(file => {
    const full = path.join(root, file);
    if (!fs.existsSync(full) || fs.statSync(full).size > 2000000) return false;
    const content = fs.readFileSync(full, 'utf8').replace(/\\n/g, '\n').replace(/['",]/g, '');
    return /-----BEGIN (?:RSA )?PRIVATE KEY-----\s*[A-Za-z0-9+/=\s]{100,}-----END (?:RSA )?PRIVATE KEY-----/.test(content);
  });
  assert.deepEqual(exposed, [], 'Private key material found in tracked paths; rotate affected IAM keys');
});
