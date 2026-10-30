const {DRIVER_ACTION_EVENT_TYPES: EVENT_TYPES} = require('../constants/driverActionEvents');
const MAX_BATCH = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCATION_STATES = new Set(['available', 'unavailable', 'permission_denied']);

function validateEvent(event, now = Date.now()) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return 'Invalid activity event';
  if (typeof event.eventId !== 'string' || !UUID.test(event.eventId)) return 'Invalid event ID';
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) return 'Invalid event sequence';
  if (typeof event.eventType !== 'string' || !EVENT_TYPES.has(event.eventType)) return 'Unsupported event type';
  if (!Number.isSafeInteger(event.occurredAtMs) || event.occurredAtMs > now + 5 * 60 * 1000) return 'Invalid event time';
  if (!LOCATION_STATES.has(event.locationState)) return 'Invalid location state';
  if ((event.lat == null) !== (event.lng == null)) return 'Incomplete coordinates';
  if (event.locationState === 'available' && (event.lat == null || event.lng == null)) return 'Missing coordinates';
  if (event.locationState !== 'available' && event.lat != null) return 'Coordinates conflict with location state';
  if (event.lat != null && (!Number.isFinite(event.lat) || event.lat < -90 || event.lat > 90
      || !Number.isFinite(event.lng) || event.lng < -180 || event.lng > 180)) return 'Invalid coordinates';
  if (event.accuracy != null && (!Number.isFinite(event.accuracy) || event.accuracy < 0 || event.accuracy > 5000)) return 'Invalid accuracy';
  if (event.durationMs != null && (!Number.isSafeInteger(event.durationMs) || event.durationMs < 0)) return 'Invalid duration';
  if (event.subjectId != null && (typeof event.subjectId !== 'string' || event.subjectId.length > 128 || /[/\\]/.test(event.subjectId))) return 'Invalid activity reference';
  if (typeof event.outcome !== 'string' || event.outcome.length > 40) return 'Invalid outcome';
  if (event.metadata != null) {
    if (!event.metadata || typeof event.metadata !== 'object' || Array.isArray(event.metadata)
        || Buffer.byteLength(JSON.stringify(event.metadata)) > 1024) return 'Invalid activity metadata';
    for (const [key, value] of Object.entries(event.metadata)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)
          || !['string', 'number', 'boolean'].includes(typeof value)
          || (typeof value === 'string' && value.length > 256)
          || (typeof value === 'number' && !Number.isFinite(value))) return 'Invalid activity metadata';
    }
  }
  return null;
}

function validDeleteRequest(payload) {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    && typeof payload.driverId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(payload.driverId)
    && typeof payload.sessionId === 'string' && UUID.test(payload.sessionId)
    && typeof payload.reason === 'string' && payload.reason.trim().length >= 5 && payload.reason.length <= 500
    && Buffer.byteLength(JSON.stringify(payload)) <= 2048;
}

function validShipmentSearch(payload) {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    && Object.keys(payload).length === 1
    && typeof payload.query === 'string'
    && Buffer.byteLength(JSON.stringify(payload)) <= 256
    && /^[A-Za-z0-9]{3,128}$/.test(normalizeShipmentSearchQuery(payload.query));
}

function normalizeShipmentSearchQuery(query) {
  return typeof query === 'string' ? query.replace(/[\s_-]/g, '') : '';
}

function validDeleteDecision(payload) {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    && typeof payload.requestId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(payload.requestId)
    && ['approved', 'denied'].includes(payload.decision)
    && (payload.reason == null || typeof payload.reason === 'string' && payload.reason.length <= 500)
    && Buffer.byteLength(JSON.stringify(payload)) <= 2048;
}

module.exports = {EVENT_TYPES, MAX_BATCH, validateEvent, validDeleteRequest, validDeleteDecision, validShipmentSearch, normalizeShipmentSearchQuery};
