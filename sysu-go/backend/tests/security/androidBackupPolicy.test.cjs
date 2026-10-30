const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const resources = path.resolve(__dirname, '../../../app/src/main');
const read = file => fs.readFileSync(path.join(resources, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const domains = ['root', 'file', 'database', 'sharedpref', 'external',
  'device_root', 'device_file', 'device_database', 'device_sharedpref'];

test('Android does not restore another device session or operational caches through backup', () => {
  assert.match(read('AndroidManifest.xml'), /android:allowBackup="false"/);
});

function excludesAll(xml) {
  for (const domain of domains) {
    assert.match(xml, new RegExp('<exclude\\s+domain="' + domain + '"\\s+path="\\."\\s*/>'),
      'Missing private-storage exclusion for ' + domain);
  }
}
test('Legacy backup excludes private auth, preferences, GPS cache and POD files', () => {
  excludesAll(read('res/xml/backup_rules.xml'));
});
for (const mode of ['cloud-backup', 'device-transfer']) {
  test('Android 12+ ' + mode + ' excludes private auth and operational caches', () => {
    const xml = read('res/xml/data_extraction_rules.xml');
    const section = new RegExp('<' + mode + '[^>]*>([\\s\\S]*?)</' + mode + '>').exec(xml);
    assert.ok(section, 'Missing ' + mode + ' policy');
    excludesAll(section[1]);
  });
}
