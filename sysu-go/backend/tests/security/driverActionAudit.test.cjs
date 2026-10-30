const test = require('node:test');
const assert = require('node:assert/strict');
const {validateEvent, EVENT_TYPES, validDeleteRequest, validDeleteDecision, validShipmentSearch} = require('../../services/driverActionPolicy');
const {createMysqlDriverActionAudit} = require('../../services/mysqlDriverActionAudit');

const driverId = '0d3a8588-8c60-4e3f-97c9-c373148234c5';
const sessionId = '0d3a8588-8c60-4e3f-97c9-c373148234c6';
const eventId = '6a1bb782-9c6f-447e-8a23-a6936b5dd414';
const validEvent = () => ({eventId, sequence: 1, eventType: 'app_open', occurredAtMs: Date.now(),
  locationState: 'unavailable', outcome: 'success', metadata: {}});

test('driver action policy accepts complete known events and zero coordinates', () => {
  assert.equal(validateEvent(validEvent()), null);
  assert.equal(validateEvent({...validEvent(), locationState: 'available', lat: 0, lng: 0}), null);
  for (const eventType of ['shipment_assigned', 'registration_opened', 'return_to_base_requested', 'session_completed']) {
    assert.equal(EVENT_TYPES.has(eventType), true);
  }
  assert.equal(validateEvent({...validEvent(), durationMs: Number.MAX_SAFE_INTEGER}), null);
});

test('driver action policy rejects invalid event shapes and activity references', () => {
  for (const event of [{...validEvent(), lat: 91}, {...validEvent(), eventType: 'arbitrary'},
    {...validEvent(), metadata: {secret: 'x'.repeat(1025)}}, {...validEvent(), subjectId: '../private'}]) {
    assert.ok(validateEvent(event));
  }
  assert.equal(validDeleteRequest({driverId: 'driver-a', sessionId, reason: 'Needs review'}), true);
  assert.equal(validDeleteRequest({driverId: 'driver-a', sessionId, reason: '  '}), false);
  assert.equal(validDeleteDecision({requestId: 'request-1', decision: 'approved'}), true);
  assert.equal(validDeleteDecision({requestId: 'request-1', decision: 'delete'}), false);
  assert.equal(validShipmentSearch({query:'101405'}), true);
  assert.equal(validShipmentSearch({query:'12'}), false);
  assert.equal(validShipmentSearch({query:'../private'}), false);
  assert.equal(validShipmentSearch({query:'101405',driverId}), false);
});

test('staff shipment search returns grouped driver IDs using live, undeleted shipment records', async () => {
  let sql = '';
  let params = [];
  const pool = {async execute(statement, values) {
    sql = statement; params = values;
    return [[
      {driver_id:driverId,shipment_ref:'10140501'},
      {driver_id:driverId,shipment_ref:'10140502'},
      {driver_id:sessionId,shipment_ref:'10140503'},
    ],[]];
  }, async getConnection() { return {}; }};
  const handlers = new Map();
  createMysqlDriverActionAudit({pool,now:()=>1234}).bind(
    {data:{uid:'staff-id',role:'admin'},on:(name,handler)=>handlers.set(name,handler)},
    {io:{to:()=>({emit(){}})}},
  );
  const response = await new Promise(resolve => handlers.get('driver_actions:search_shipment')({query:'101405'},resolve));
  assert.match(sql,/e\.shipment_ref LIKE CONCAT\(\?, '%\'\)/);
  assert.match(sql,/e\.shipment_ref_reversed LIKE CONCAT\(REVERSE\(\?\), '%\'\)/);
  assert.match(sql,/s\.deleted_at_ms IS NULL/);
  assert.doesNotMatch(sql,/expires_at_ms/);
  assert.equal(params[0],'101405');
  assert.equal(params[1],'101405');
  assert.deepEqual(response,{success:true,drivers:[
    {driverId,shipmentIds:['10140501','10140502']},
    {driverId:sessionId,shipmentIds:['10140503']},
  ],truncated:false});
});

function auditService(now = () => Date.now()) {
  const state = {session: null, events: [], statements: []};
  const pool = {execute: async () => [[], []], getConnection: async () => ({
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql, values) {
      state.statements.push(sql);
      if (sql.includes('FROM app_driver_action_events')) return [state.events.filter(row => row.event_id === values[0]), []];
      if (sql.includes('FROM app_driver_action_sessions')) return [[state.session].filter(Boolean), []];
      if (sql.includes('INSERT INTO app_driver_action_sessions')) {
        state.session = {session_id: values[0], driver_id: values[1], status: values[2],
          started_at_ms: values[3], completed_at_ms: values[5], last_sequence: 0};
        return [{affectedRows: 1}, []];
      }
      if (sql.includes('INSERT INTO app_driver_action_events')) {
        state.events.push({event_id: values[0], session_id: values[1], driver_id: values[2], sequence_no: values[3], data: values[7]});
        return [{affectedRows: 1}, []];
      }
      if (sql.includes('UPDATE app_driver_action_sessions')) {
        state.session.last_sequence = values[2];
        state.session.status = values[0];
        if (values[3] === 'completed') state.session.completed_at_ms = values[4];
        return [{affectedRows: 1}, []];
      }
      throw new Error('Unexpected SQL statement');
    },
  })};
  return {state, service: createMysqlDriverActionAudit({pool, now})};
}

test('MySQL driver action sync persists idempotently under the authenticated driver', async () => {
  const {state, service} = auditService();
  const handlers = new Map();
  const broadcasts = [];
  service.bind({data: {uid: driverId, role: 'driver'}, on: (name, handler) => handlers.set(name, handler)},
    {io: {to: room => ({emit: (...args) => broadcasts.push({room, args})})}});
  const invoke = payload => new Promise(resolve => handlers.get('driver_actions:sync')(payload, resolve));
  const payload = {sessionId, events: [validEvent()]};
  assert.deepEqual(await invoke(payload), {success: true, acceptedEventIds: [eventId], terminalEventIds: []});
  assert.equal(state.events.length, 1);
  assert.match(state.statements.find(sql => sql.includes('INSERT INTO app_driver_action_sessions')), /VALUES \(\?, \?, \?, \?, \?, 0, \?, 0,/);
  assert.match(state.statements.find(sql => sql.includes('INSERT INTO app_driver_action_events')), /VALUES \(\?, \?, \?, \?, \?, \?, \?, 0,/);
  assert.deepEqual(await invoke(payload), {success: true, acceptedEventIds: [eventId], terminalEventIds: []});
  assert.equal(state.events.length, 1);
  assert.equal(broadcasts.length, 2);
  const spoofed = await invoke({sessionId, driverId: 'victim', events: [validEvent()]});
  assert.equal(spoofed.success, true);
  assert.equal(state.events[0].driver_id, driverId);
  assert.equal(state.events[0].driver_id, driverId);
});

test('driver activity older than 90 days remains accepted for offline upload', async () => {
  const oldTime = Date.now() - 120 * 24 * 60 * 60 * 1000;
  const {state, service} = auditService(() => Date.now());
  const handlers = new Map();
  service.bind({data: {uid: driverId, role: 'driver'}, on: (name, handler) => handlers.set(name, handler)},
    {io: {to: () => ({emit() {}})}});
  const event = {...validEvent(), occurredAtMs: oldTime};
  const response = await new Promise(resolve => handlers.get('driver_actions:sync')({sessionId, events: [event]}, resolve));
  assert.equal(response.success, true);
  assert.deepEqual(response.terminalEventIds, []);
  assert.equal(state.events.length, 1);
});

test('completed session duration uses device event time instead of delayed server receipt time', async () => {
  const {state, service} = auditService(() => 10_000);
  const handlers = new Map();
  service.bind({data: {uid: driverId, role: 'driver'}, on: (name, handler) => handlers.set(name, handler)},
    {io: {to: () => ({emit() {}})}});
  const invoke = events => new Promise(resolve => handlers.get('driver_actions:sync')({sessionId, events}, resolve));
  const started = {...validEvent(), eventId: '6a1bb782-9c6f-447e-8a23-a6936b5dd415', sequence: 1, occurredAtMs: 1_000};
  const completed = {...validEvent(), eventId: '6a1bb782-9c6f-447e-8a23-a6936b5dd416', sequence: 2,
    eventType: 'session_completed', occurredAtMs: 5_000};

  assert.equal((await invoke([started])).success, true);
  assert.equal((await invoke([completed])).success, true);
  assert.equal(state.session.started_at_ms, 1_000);
  assert.equal(state.session.completed_at_ms, 5_000);
  assert.equal(state.session.completed_at_ms - state.session.started_at_ms, 4_000);
});

test('a requested warehouse arrival does not close the session before final confirmation', async () => {
  const {state, service} = auditService(() => 10_000);
  const handlers = new Map();
  service.bind({data: {uid: driverId, role: 'driver'}, on: (name, handler) => handlers.set(name, handler)},
    {io: {to: () => ({emit() {}})}});
  const invoke = events => new Promise(resolve => handlers.get('driver_actions:sync')({sessionId, events}, resolve));
  const started = {...validEvent(), eventId: '6a1bb782-9c6f-447e-8a23-a6936b5dd417', sequence: 1, occurredAtMs: 1_000};
  const requestedArrival = {...validEvent(), eventId: '6a1bb782-9c6f-447e-8a23-a6936b5dd418', sequence: 2,
    eventType: 'arrived_at_warehouse', outcome: 'requested', occurredAtMs: 5_000};
  const completed = {...validEvent(), eventId: '6a1bb782-9c6f-447e-8a23-a6936b5dd419', sequence: 3,
    eventType: 'session_completed', occurredAtMs: 6_000};

  assert.equal((await invoke([started])).success, true);
  assert.equal((await invoke([requestedArrival])).success, true);
  assert.equal(state.session.status, 'active');
  assert.equal(state.session.completed_at_ms, null);
  assert.equal((await invoke([completed])).success, true);
  assert.equal(state.session.status, 'completed');
  assert.equal(state.session.completed_at_ms, 6_000);
});

test('final confirmation time replaces a legacy arrival completion timestamp', async () => {
  const {state, service} = auditService(() => 10_000);
  const handlers = new Map();
  service.bind({data: {uid: driverId, role: 'driver'}, on: (name, handler) => handlers.set(name, handler)},
    {io: {to: () => ({emit() {}})}});
  const invoke = events => new Promise(resolve => handlers.get('driver_actions:sync')({sessionId, events}, resolve));
  const legacyArrival = {...validEvent(), eventId: '6a1bb782-9c6f-447e-8a23-a6936b5dd420', sequence: 1,
    eventType: 'arrived_at_warehouse', outcome: 'success', occurredAtMs: 5_000};
  const completed = {...validEvent(), eventId: '6a1bb782-9c6f-447e-8a23-a6936b5dd421', sequence: 2,
    eventType: 'session_completed', occurredAtMs: 6_000};

  assert.equal((await invoke([legacyArrival])).success, true);
  assert.equal(state.session.completed_at_ms, 5_000);
  assert.equal((await invoke([completed])).success, true);
  assert.equal(state.session.completed_at_ms, 6_000);
});

test('staff session listings measure sessions from joining the queue through completion', async () => {
  const tripStartedAt = 1_000_000;
  const tripCompletedAt = 1_600_000;
  let sessionQuery = '';
  let boundsQuery = '';
  let assignmentsQuery = '';
  const pool = {
    async execute(sql) {
      if (sql.includes('FROM app_driver_action_sessions')) {
        sessionQuery = sql;
        return [[{
          session_id: sessionId, driver_id: driverId, status: 'completed', started_at_ms: 10,
          updated_at_ms: 20, last_sequence: 5, completed_at_ms: 30, expires_at_ms: 40,
          deleted_at_ms: null, deleted_by: null, pending_deletion_request_id: null,
        }], []];
      }
      if (sql.includes("event_type = 'shipment_assigned'")) {
        assignmentsQuery = sql;
        return [[
          {session_id: sessionId, shipment_ref: '0010140501'},
          {session_id: sessionId, shipment_ref: '0010140502'},
          {session_id: sessionId, shipment_ref: '0010140501'},
        ], []];
      }
      boundsQuery = sql;
      return [[{session_id: sessionId, trip_started_at_ms: tripStartedAt, trip_completed_at_ms: tripCompletedAt}], []];
    },
    async getConnection() { return {}; },
  };
  const handlers = new Map();
  createMysqlDriverActionAudit({pool}).bind(
    {data: {uid: driverId, role: 'admin'}, on: (name, handler) => handlers.set(name, handler)},
    {io: {to: () => ({emit() {}})}},
  );
  const response = await new Promise(resolve => handlers.get('driver_actions:get_sessions')(
    {driverId, limit: 10}, resolve,
  ));

  assert.match(sessionQuery, /FROM app_driver_action_sessions/);
  assert.match(boundsQuery, /event_type = 'queue_joined'/);
  assert.match(boundsQuery, /event_type = 'session_completed'/);
  assert.match(assignmentsQuery, /shipment_ref IS NOT NULL/);
  assert.equal(response.sessions[0].startedAt.$timestamp, 10);
  assert.equal(response.sessions[0].completedAt.$timestamp, 30);
  assert.equal(response.sessions[0].tripStartedAt.$timestamp, tripStartedAt);
  assert.equal(response.sessions[0].tripCompletedAt.$timestamp, tripCompletedAt);
  assert.deepEqual(response.sessions[0].shipments, ['0010140501', '0010140502']);
});

test('staff session listings use the confirmed session end when legacy event bounds are missing', async () => {
  const handlers = new Map();
  const pool = {
    async execute(sql) {
      if (sql.includes('FROM app_driver_action_sessions')) return [[{
        session_id: sessionId, driver_id: driverId, status: 'completed', started_at_ms: 10,
        updated_at_ms: 20, last_sequence: 5, completed_at_ms: 1_600_000,
        expires_at_ms: 40, deleted_at_ms: null, deleted_by: null, pending_deletion_request_id: null,
      }], []];
      if (sql.includes("event_type = 'shipment_assigned'")) return [[], []];
      return [[{session_id: sessionId, trip_started_at_ms: 1_000_000, trip_completed_at_ms: null}], []];
    },
    async getConnection() { return {}; },
  };
  createMysqlDriverActionAudit({pool}).bind(
    {data: {uid: driverId, role: 'admin'}, on: (name, handler) => handlers.set(name, handler)},
    {io: {to: () => ({emit() {}})}},
  );
  const response = await new Promise(resolve => handlers.get('driver_actions:get_sessions')(
    {driverId, limit: 10}, resolve,
  ));
  assert.equal(response.sessions[0].tripStartedAt.$timestamp, 1_000_000);
  assert.equal(response.sessions[0].tripCompletedAt.$timestamp, 1_600_000);
});

test('approved web removal deletes a driver session while retaining its removal-request audit', async () => {
  const statements = [];
  const request = {request_id: 'request-1', driver_id: driverId, session_id: sessionId, requested_by: 'different-staff', status: 'pending'};
  const session = {session_id: sessionId, driver_id: driverId, pending_deletion_request_id: 'request-1', deleted_at_ms: null};
  const pool = {
    async execute() { return [[], []]; },
    async getConnection() { return {
      async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
      async execute(sql, values) {
        statements.push(sql);
        if (sql.includes('FROM app_driver_action_delete_requests')) return [[request], []];
        if (sql.includes('FROM app_driver_action_sessions')) return [[session], []];
        return [{affectedRows: 1}, []];
      },
    }; },
  };
  const handlers = new Map();
  createMysqlDriverActionAudit({pool, now: () => 5000}).bind(
    {data: {uid: 'reviewing-admin', role: 'admin'}, on: (name, handler) => handlers.set(name, handler)},
    {io: {to: () => ({emit() {}})}},
  );
  const response = await new Promise(resolve => handlers.get('driver_actions:decide_delete')(
    {requestId: 'request-1', decision: 'approved'}, resolve,
  ));
  assert.equal(response.success, true);
  assert.ok(statements.some(sql => sql.includes('UPDATE app_driver_action_delete_requests')));
  assert.ok(statements.some(sql => sql.includes('DELETE FROM app_driver_action_sessions')));
  assert.ok(!statements.some(sql => sql.includes('DELETE FROM app_driver_action_delete_requests')));
});
