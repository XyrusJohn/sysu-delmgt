const test = require("node:test");
const assert = require("node:assert/strict");
const {bindRealtimeSubscriptions} = require("./realtimeSubscriptions");

function fixture({queueOwner = "driver-1"} = {}) {
  const handlers = new Map();
  const events = [];
  const queue = {id: "queue-1", driverId: queueOwner, status: "waiting", registrationComplete: true};
  const services = {
    mysqlMasterData: {
      listGuards: async () => [{id: "guard-1", firstName: "Sam", active: true}],
      listCompanies: async () => [{id: "company-1", name: "Example Trucking", active: true}],
    },
    mysqlDriverProfiles: {get: async uid => ({id: uid, name: "Synthetic Driver"})},
    mysqlAuthService: {authenticate: async () => ({id: "driver-1", username: "driver.one", role: "driver", status: "active", profile: {name: "Synthetic Driver"}})},
    mysqlQrService: {
      get: async id => id === queue.id ? queue : null,
      listOwn: async () => [queue],
      ownPosition: async (uid, id) => ({queueId: id, position: uid === queue.driverId ? 1 : null}),
    },
    mysqlAssignments: {listOwn: async uid => [{id: "dispatch-1", driverId: uid, tripStatus: "in_transit"}]},
    mysqlLiveLocations: {get: async uid => ({driverId: uid, lat: 14.5, lng: 121})},
  };
  const socket = {
    data: {uid: "driver-1", role: "driver", token: "session-token"},
    on: (event, callback) => handlers.set(event, callback),
    once: (event, callback) => handlers.set(`${event}:once`, callback),
    emit: (event, payload) => events.push({event, payload}),
  };
  bindRealtimeSubscriptions(socket, services);
  return {handlers, events, queue, socket};
}

async function subscribe(f, topic, id = "sub-1", params) {
  let ack;
  await f.handlers.get("realtime:subscribe")({id, topic, ...(params ? {params} : {})}, value => {ack = value;});
  await new Promise(resolve => setImmediate(resolve));
  return ack;
}

function unsubscribe(f, id = "sub-1") {
  f.handlers.get("realtime:unsubscribe")({id}, () => {});
}

test("MySQL assignment and live-location subscriptions stream only the authenticated driver's records", async () => {
  const f = fixture();
  assert.equal((await subscribe(f, "assignments", "assignments-1")).success, true);
  assert.deepEqual(f.events.at(-1).payload.data, [{id: "dispatch-1", driverId: "driver-1", tripStatus: "in_transit"}]);
  unsubscribe(f, "assignments-1");
  assert.equal((await subscribe(f, "location", "location-1")).success, true);
  assert.deepEqual(f.events.at(-1).payload.data, {driverId: "driver-1", lat: 14.5, lng: 121});
  unsubscribe(f, "location-1");
});

test("MySQL queue subscriptions enforce ownership and emit the driver's queue data", async () => {
  const f = fixture({queueOwner: "another-driver"});
  assert.deepEqual(await subscribe(f, "queue", "queue-foreign", {queueId: "queue-1"}),
    {success: false, message: "Subscription not authorized"});
  f.queue.driverId = "driver-1";
  assert.deepEqual(await subscribe(f, "queue", "queue-own", {queueId: "queue-1"}),
    {success: true, id: "queue-own", topic: "queue"});
  assert.deepEqual(f.events.at(-1).payload.data, f.queue);
  unsubscribe(f, "queue-own");
});

test("MySQL queue-position subscription validates its queue session and streams current position", async () => {
  const f = fixture();
  assert.deepEqual(await subscribe(f, "queuePosition", "position-1", {queueId: "queue-1"}),
    {success: true, id: "position-1", topic: "queuePosition"});
  assert.deepEqual(f.events.at(-1).payload.data, {queueId: "queue-1", position: 1});
  unsubscribe(f, "position-1");
  assert.deepEqual(await subscribe(f, "queuePosition", "position-bad", {queueId: "bad/id"}),
    {success: false, message: "Invalid queue session"});
});

test("MySQL profile, driver, and master-data subscriptions return their SQL-backed records", async () => {
  const f = fixture();
  assert.equal((await subscribe(f, "profile", "profile-1")).success, true);
  assert.equal(f.events.at(-1).payload.data.role, "driver");
  unsubscribe(f, "profile-1");
  assert.equal((await subscribe(f, "driver", "driver-1")).success, true);
  assert.deepEqual(f.events.at(-1).payload.data, {id: "driver-1", name: "Synthetic Driver"});
  unsubscribe(f, "driver-1");
  assert.equal((await subscribe(f, "securityGuards", "guards-1")).success, true);
  assert.deepEqual(f.events.at(-1).payload.data, [{id: "guard-1", firstName: "Sam", active: true}]);
  unsubscribe(f, "guards-1");
  assert.equal((await subscribe(f, "truckCompanies", "companies-1")).success, true);
  assert.deepEqual(f.events.at(-1).payload.data, [{id: "company-1", name: "Example Trucking", active: true}]);
  unsubscribe(f, "companies-1");
});

test("unsupported and unknown topics fail closed without attempting a database fallback", async () => {
  const f = fixture();
  for (const topic of ["incidents", "legacyOverrideRequests", "unknown"]) {
    assert.deepEqual(await subscribe(f, topic, `unsupported-${topic}`),
      {success: false, message: "Realtime topic is unavailable"});
  }
  assert.equal(f.events.length, 0);
});
