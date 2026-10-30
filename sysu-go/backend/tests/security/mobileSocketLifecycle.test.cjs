const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../../app/src/main/java/com/sysu/go/network/SocketManager.kt'), 'utf8');
test('removing a mobile listener never sends an empty unauthorized protocol packet', () => {
  const body = source.split('private fun unregisterEventListenerOnSocket')[1].split('private fun registerAllListenersOnSocket')[0];
  assert.doesNotMatch(body, /socket\.emit\(/);
});
test('logout cancels a connecting socket as well as a connected socket', () => {
  const body = source.split('fun disconnect()')[1].split('override fun onConnectivityChanged')[0];
  assert.doesNotMatch(body, /if \(socket\.connected\(\)\)/);
  assert.match(body, /sessionGate\.invalidate\(\)/);
});
