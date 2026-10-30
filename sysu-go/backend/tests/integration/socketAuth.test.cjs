const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {once} = require('node:events');
const {Server} = require('socket.io');
const {io: clientIo} = require('socket.io-client');
const {createSocketAuth} = require('../../middleware/socketAuth.js');

async function fixture() {
  const sessions = new Map([
    ['synthetic-driver-token-01', {id: 'driver-a', role: 'driver', status: 'active'}],
    ['synthetic-driver-token-02', {id: 'driver-a', role: 'driver', status: 'active'}],
    ['synthetic-other-driver-token-01', {id: 'driver-b', role: 'driver', status: 'active'}],
    ['synthetic-staff-token-01', {id: 'staff-a', role: 'fleet_manager', status: 'active'}],
  ]);
  const server = http.createServer();
  const io = new Server(server, {transports: ['websocket']});
  io.use(createSocketAuth({authenticateSession: async token => sessions.get(token) || null}));
  io.on('connection', socket => {
    if (['fleet_manager', 'admin', 'super_admin'].includes(socket.data.role)) socket.join('staff:tracking');
    socket.on('driver_moving', payload => io.to('staff:tracking').emit('driver_location', payload));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    io,
    sessions,
    close: async () => new Promise(resolve => io.close(resolve)),
  };
}

function connect(url, token) {
  return clientIo(url, {autoConnect: false, transports: ['websocket'], reconnection: false,
    auth: token ? {token} : {}});
}

test('Socket.IO rejects missing, revoked, and inactive MySQL sessions', async () => {
  const f = await fixture();
  const anonymous = connect(f.url, null);
  try {
    const rejected = once(anonymous, 'connect_error');
    anonymous.connect();
    const [error] = await rejected;
    assert.match(error.message, /authentication/i);
  } finally {
    anonymous.close();
  }

  const revoked = connect(f.url, 'synthetic-revoked-session-token');
  try {
    const rejected = once(revoked, 'connect_error');
    revoked.connect();
    const [error] = await rejected;
    assert.match(error.message, /authentication/i);
  } finally {
    revoked.close();
  }

  f.sessions.set('synthetic-disabled-session-token', {id: 'driver-a', role: 'driver', status: 'disabled'});
  const disabled = connect(f.url, 'synthetic-disabled-session-token');
  try {
    const rejected = once(disabled, 'connect_error');
    disabled.connect();
    const [error] = await rejected;
    assert.match(error.message, /authentication/i);
  } finally {
    disabled.close();
    await f.close();
  }
});

test('authenticated driver location events reach tracking staff only', async () => {
  const f = await fixture();
  const driver = connect(f.url, 'synthetic-driver-token-01');
  const staff = connect(f.url, 'synthetic-staff-token-01');
  const other = connect(f.url, 'synthetic-other-driver-token-01');
  try {
    const connected = [once(driver, 'connect'), once(staff, 'connect'), once(other, 'connect')];
    driver.connect();
    staff.connect();
    other.connect();
    await Promise.all(connected);
    const delivered = once(staff, 'driver_location');
    driver.emit('driver_moving', {driverId: 'driver-a', lat: 14.6, lng: 121.0});
    const [payload] = await delivered;
    assert.equal(payload.driverId, 'driver-a');
    const leaked = await Promise.race([
      once(other, 'driver_location').then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), 100)),
    ]);
    assert.equal(leaked, false);
  } finally {
    driver.close();
    staff.close();
    other.close();
    await f.close();
  }
});

test('revoked MySQL sessions are disconnected on the next socket event', async () => {
  const f = await fixture();
  const driver = connect(f.url, 'synthetic-driver-token-02');
  try {
    const connected = once(driver, 'connect');
    driver.connect();
    await connected;
    f.sessions.delete('synthetic-driver-token-02');
    const disconnected = once(driver, 'disconnect');
    driver.emit('heartbeat');
    await disconnected;
    assert.equal(driver.connected, false);
  } finally {
    driver.close();
    await f.close();
  }
});
