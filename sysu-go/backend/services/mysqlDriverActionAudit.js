const {randomUUID} = require('node:crypto');
const {validateEvent, MAX_BATCH, validDeleteRequest, validDeleteDecision, validShipmentSearch, normalizeShipmentSearchQuery} = require('./driverActionPolicy');
const MAX_PAGE = 500;
const STAFF = new Set(['fleet_manager', 'admin', 'super_admin']);
const ADMIN = new Set(['admin', 'super_admin']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const limit = value => Number.isSafeInteger(value) ? Math.max(1, Math.min(MAX_PAGE, value)) : 50;
const isRead = (payload, needsSession) => payload && typeof payload === 'object' && !Array.isArray(payload)
  && typeof payload.driverId === 'string' && UUID.test(payload.driverId)
  && (!needsSession || typeof payload.sessionId === 'string' && UUID.test(payload.sessionId))
  && (payload.cursor == null || Number.isSafeInteger(payload.cursor) && payload.cursor >= 0)
  && Buffer.byteLength(JSON.stringify(payload)) <= 2048;
const timestamp = ms => ({$timestamp: Number(ms)});
const isSessionCompletionEvent = event => event?.eventType === 'session_completed'
  || event?.eventType === 'arrived_at_warehouse' && event?.outcome !== 'requested';
const SHIPMENT_SEARCH_EVENTS = new Set([
  'shipment_assigned', 'active_shipment_selected', 'loading_started', 'loading_cancelled',
  'fully_loaded', 'verification_cancelled', 'guard_verified', 'transit_started', 'route_point',
  'unloading_started', 'pod_captured', 'all_deliveries_completed', 'return_to_base_requested',
  'returning_to_base', 'arrived_at_warehouse', 'warehouse_arrival_confirmed',
]);

function createMysqlDriverActionAudit({pool, now = () => Date.now()}) {
  if (!pool?.getConnection || !pool?.execute) throw new TypeError('A MySQL pool is required');
  const transaction = async work => {
    const connection = await pool.getConnection();
    let begun = false;
    try {await connection.beginTransaction();begun = true;const result = await work(connection);await connection.commit();begun = false;return result;}
    catch (error) {if (begun) await connection.rollback();throw error;}
    finally {connection.release();}
  };

  async function bind(socket, {io}) {
    const uid = socket.data.uid, role = socket.data.role;
    const ack = (callback, value) => {if (typeof callback === 'function') callback(value);};
    const notify = payload => io.to('staff:tracking').emit('driver_actions:updated', payload);
    socket.on('driver_actions:sync', async (payload, callback) => {
      const events = payload?.events;
      if (role !== 'driver' || !UUID.test(uid || '') || !UUID.test(payload?.sessionId || '')
        || !Array.isArray(events) || !events.length || events.length > MAX_BATCH
        || Buffer.byteLength(JSON.stringify(payload)) > 64 * 1024) return ack(callback, {success:false,acceptedEventIds:[],message:'Invalid activity batch'});
      const currentTime = now();
      let previous = 0;
      for (const event of events) {
        const invalid = validateEvent(event, currentTime);
        if (invalid || event.sessionId != null && event.sessionId !== payload.sessionId
          || event.sequence <= previous || Object.hasOwn(event, 'driverId')) {
          return ack(callback, {success:false,acceptedEventIds:[],message:invalid || 'Invalid activity batch'});
        }
        previous = event.sequence;
      }
      try {
        const acceptedEventIds = await transaction(async connection => {
          const [sessions] = await connection.execute('SELECT * FROM app_driver_action_sessions WHERE session_id = ? FOR UPDATE', [payload.sessionId]);
          let session = sessions[0];
          if (session && session.driver_id !== uid) throw new Error('Activity session ownership conflict');
          let lastSequence = Number(session?.last_sequence || 0);
          const accepted = [];
          let hasCompletion = false;
          let hasFinalCompletion = false;
          let completionAtMs = null;
          const firstActive = events[0];
          const createdSession = !session && Boolean(firstActive);
          if (!session && firstActive) {
            const startsCompleted = isSessionCompletionEvent(firstActive);
            await connection.execute(
              `INSERT INTO app_driver_action_sessions
                 (session_id, driver_id, status, started_at_ms, updated_at_ms, last_sequence, completed_at_ms, expires_at_ms, data)
               VALUES (?, ?, ?, ?, ?, 0, ?, 0, '{}')`,
              [payload.sessionId, uid, startsCompleted ? 'completed' : 'active', firstActive.occurredAtMs,
                currentTime, startsCompleted ? firstActive.occurredAtMs : null]);
            session = {status: startsCompleted ? 'completed' : 'active',
              completed_at_ms: startsCompleted ? firstActive.occurredAtMs : null};
          }
          for (const event of events) {
            const [saved] = await connection.execute('SELECT driver_id, session_id FROM app_driver_action_events WHERE event_id = ? FOR UPDATE', [event.eventId]);
            if (saved[0]) {
              if (saved[0].driver_id !== uid || saved[0].session_id !== payload.sessionId) throw new Error('Activity event ownership conflict');
              accepted.push(event.eventId); continue;
            }
            if (!createdSession && session?.status === 'completed' && event.eventType !== 'session_completed') throw new Error('Activity sequence conflict');
            lastSequence = Math.max(lastSequence, event.sequence);
            const completed = isSessionCompletionEvent(event);
            hasCompletion ||= completed;
            if (event.eventType === 'session_completed') {
              hasFinalCompletion = true;
              completionAtMs = event.occurredAtMs;
            } else if (completed && completionAtMs == null) completionAtMs = event.occurredAtMs;
            const record = {driverId: uid, sessionId: payload.sessionId, eventId: event.eventId,
              sequence: event.sequence, eventType: event.eventType, occurredAtMs: event.occurredAtMs,
              receivedAtMs: currentTime, lat: event.lat ?? null, lng: event.lng ?? null,
              accuracy: event.accuracy ?? null, locationState: event.locationState,
              subjectId: event.subjectId ?? null, outcome: event.outcome, durationMs: event.durationMs ?? null,
              metadata: event.metadata || {}};
            await connection.execute(
              `INSERT INTO app_driver_action_events
                 (event_id, session_id, driver_id, sequence_no, event_type, occurred_at_ms, received_at_ms, expires_at_ms, data)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
              [event.eventId, payload.sessionId, uid, event.sequence, event.eventType, event.occurredAtMs,
                currentTime, JSON.stringify(record)]);
            accepted.push(event.eventId);
          }
          if (session) {
            const completedAtMs = hasFinalCompletion
              ? completionAtMs
              : session.completed_at_ms ?? completionAtMs ?? currentTime;
            await connection.execute(
              `UPDATE app_driver_action_sessions SET status = ?, updated_at_ms = ?, last_sequence = ?,
                  completed_at_ms = IF(? = 'completed', ?, completed_at_ms), expires_at_ms = 0
                WHERE session_id = ?`,
              [hasCompletion ? 'completed' : session.status, currentTime, lastSequence,
                hasCompletion ? 'completed' : session.status, completedAtMs,
                payload.sessionId]);
          }
          return accepted;
        });
        ack(callback, {success:true,acceptedEventIds,terminalEventIds:[]});
        if (acceptedEventIds.length) notify({driverId:uid,sessionId:payload.sessionId,receivedAtMs:currentTime});
      } catch (error) {
        console.error('[driver-action] MySQL sync failed', {errorName: error?.name || 'Error', errorCode: error?.code || null});
        ack(callback,{success:false,acceptedEventIds:[],message:'Activity history could not be synced'});
      }
    });

    socket.on('driver_actions:get_sessions', async (payload, callback) => {
      if (!STAFF.has(role) || !isRead(payload, false)) return ack(callback,{success:false,message:'Activity history is not available'});
      try {
        const page = limit(payload.limit);
        const [rows] = await pool.execute(
          `SELECT session_id, driver_id, status, started_at_ms, updated_at_ms, last_sequence, completed_at_ms,
                  expires_at_ms, deleted_at_ms, deleted_by, pending_deletion_request_id
             FROM app_driver_action_sessions WHERE driver_id = ? AND deleted_at_ms IS NULL
               AND (? IS NULL OR started_at_ms < ?) ORDER BY started_at_ms DESC LIMIT ?`,
          [payload.driverId, payload.cursor || null, payload.cursor || null, page + 1]);
        const tripBounds = new Map();
        if (rows.length) {
          const sessionIds = rows.map(row => row.session_id);
          const [bounds] = await pool.execute(
            `SELECT session_id,
                    MIN(CASE WHEN event_type = 'queue_joined' THEN occurred_at_ms END) AS trip_started_at_ms,
                    MAX(CASE WHEN event_type = 'session_completed' THEN occurred_at_ms END) AS trip_completed_at_ms
               FROM app_driver_action_events WHERE driver_id = ? AND session_id IN (${sessionIds.map(() => '?').join(',')})
               GROUP BY session_id`,
            [payload.driverId, ...sessionIds]);
          bounds.forEach(row => tripBounds.set(row.session_id, row));
        }
        const more = rows.length > page, visible = rows.slice(0, page);
        const assignedShipments = new Map();
        if (visible.length) {
          const sessionIds = visible.map(row => row.session_id);
          const [assignments] = await pool.execute(
            `SELECT session_id, shipment_ref FROM app_driver_action_events
              WHERE driver_id = ? AND event_type = 'shipment_assigned' AND shipment_ref IS NOT NULL
                AND session_id IN (${sessionIds.map(() => '?').join(',')})
              ORDER BY session_id, sequence_no`,
            [payload.driverId, ...sessionIds]);
          assignments.forEach(({session_id: sessionId, shipment_ref: shipmentRef}) => {
            if (typeof shipmentRef !== 'string' || !shipmentRef.trim()) return;
            const shipments = assignedShipments.get(sessionId) || [];
            if (!shipments.includes(shipmentRef)) shipments.push(shipmentRef);
            assignedShipments.set(sessionId, shipments);
          });
        }
        ack(callback,{success:true,sessions:visible.map(row=>({id:row.session_id,driverId:row.driver_id,status:row.status,
          startedAt:timestamp(row.started_at_ms),updatedAt:timestamp(row.updated_at_ms),lastSequence:Number(row.last_sequence),
          shipments:assignedShipments.get(row.session_id) || [],
          completedAt:row.completed_at_ms==null?null:timestamp(row.completed_at_ms),expiresAt:null,
          tripStartedAt:tripBounds.get(row.session_id)?.trip_started_at_ms==null?null:timestamp(tripBounds.get(row.session_id).trip_started_at_ms),
          tripCompletedAt:tripBounds.get(row.session_id)?.trip_completed_at_ms!=null
            ? timestamp(tripBounds.get(row.session_id).trip_completed_at_ms)
            : row.status === 'completed' && row.completed_at_ms != null ? timestamp(row.completed_at_ms) : null,
          pendingDeletionRequestId:row.pending_deletion_request_id})),nextCursor:more?Number(visible.at(-1)?.started_at_ms)||null:null});
      } catch (error) {
        console.error('[driver-action] MySQL sessions read failed', {errorName:error?.name||'Error',errorCode:error?.code||null});
        ack(callback,{success:false,errorCode:'DRIVER_ACTION_SESSIONS_READ_FAILED',message:'Activity history is temporarily unavailable'});
      }
    });

    socket.on('driver_actions:search_shipment', async (payload, callback) => {
      if (!STAFF.has(role) || !validShipmentSearch(payload)) return ack(callback,{success:false,message:'Shipment search is not available'});
      try {
        const pageSize = 201;
        const query = normalizeShipmentSearchQuery(payload.query);
        const [rows] = await pool.execute(
          `SELECT DISTINCT e.driver_id, e.shipment_ref
             FROM app_driver_action_events e
             INNER JOIN app_driver_action_sessions s ON s.session_id = e.session_id
            WHERE (e.shipment_ref LIKE CONCAT(?, '%')
               OR e.shipment_ref_reversed LIKE CONCAT(REVERSE(?), '%')
               OR e.shipment_ref LIKE CONCAT('%', ?, '%'))
              AND e.event_type IN (${[...SHIPMENT_SEARCH_EVENTS].map(() => '?').join(',')})
              AND s.deleted_at_ms IS NULL
            ORDER BY e.shipment_ref, e.driver_id LIMIT ?`,
          [query, query, query, ...SHIPMENT_SEARCH_EVENTS, pageSize]);
        const truncated = rows.length > 200;
        const visible = rows.slice(0, 200);
        const byDriver = new Map();
        for (const row of visible) {
          if (!byDriver.has(row.driver_id)) byDriver.set(row.driver_id, new Set());
          byDriver.get(row.driver_id).add(row.shipment_ref);
        }
        ack(callback,{success:true,drivers:[...byDriver].map(([driverId, shipmentIds]) => ({driverId,shipmentIds:[...shipmentIds]})),truncated});
      } catch (error) {
        console.error('[driver-action] shipment search failed', {errorName:error?.name||'Error',errorCode:error?.code||null});
        ack(callback,{success:false,errorCode:'DRIVER_ACTION_SHIPMENT_SEARCH_FAILED',message:'Shipment search is temporarily unavailable'});
      }
    });

    socket.on('driver_actions:get_events', async (payload, callback) => {
      if (!STAFF.has(role) || !isRead(payload, true)) return ack(callback,{success:false,message:'Activity history is not available'});
      try {
        const [sessions] = await pool.execute('SELECT driver_id, deleted_at_ms FROM app_driver_action_sessions WHERE session_id = ? LIMIT 1',[payload.sessionId]);
        if (!sessions[0] || sessions[0].driver_id !== payload.driverId || sessions[0].deleted_at_ms != null) return ack(callback,{success:false,message:'Activity history is not available'});
        const page=limit(payload.limit);
        const [rows]=await pool.execute(`SELECT event_id, data, sequence_no FROM app_driver_action_events
          WHERE driver_id=? AND session_id=? AND (? IS NULL OR sequence_no < ?) ORDER BY sequence_no DESC LIMIT ?`,
          [payload.driverId,payload.sessionId,payload.cursor||null,payload.cursor||null,page+1]);
        const more=rows.length>page,visible=rows.slice(0,page);
        ack(callback,{success:true,events:visible.map(row=>({id:row.event_id,...(typeof row.data==='string'?JSON.parse(row.data):row.data)})),nextCursor:more?Number(visible.at(-1)?.sequence_no)||null:null});
      } catch (_) {ack(callback,{success:false,errorCode:'DRIVER_ACTION_EVENTS_READ_FAILED',message:'Activity history is temporarily unavailable'});}
    });

    socket.on('driver_actions:request_delete', async (payload, callback) => {
      if (!STAFF.has(role) || !validDeleteRequest(payload)) return ack(callback,{success:false,errorCode:'DRIVER_ACTION_DELETE_REQUEST_INVALID',message:'Unable to request session removal.'});
      try {
        const result=await transaction(async connection=>{
          const [sessions]=await connection.execute('SELECT * FROM app_driver_action_sessions WHERE session_id=? FOR UPDATE',[payload.sessionId]);
          const session=sessions[0]; if(!session||session.driver_id!==payload.driverId||session.deleted_at_ms!=null)return {error:'Session is unavailable.'};
          if(session.pending_deletion_request_id){const [pending]=await connection.execute('SELECT request_id,status FROM app_driver_action_delete_requests WHERE request_id=? FOR UPDATE',[session.pending_deletion_request_id]);if(pending[0]?.status==='pending')return {requestId:pending[0].request_id,status:'pending'};}
          const requestId=randomUUID();
          await connection.execute(`INSERT INTO app_driver_action_delete_requests
            (request_id,driver_id,session_id,reason,requested_by,requested_by_role,requested_at_ms,status)
            VALUES (?,?,?,?,?,?,?,'pending')`,[requestId,payload.driverId,payload.sessionId,payload.reason.trim(),uid,role,now()]);
          await connection.execute('UPDATE app_driver_action_sessions SET pending_deletion_request_id=? WHERE session_id=?',[requestId,payload.sessionId]);
          return {requestId,status:'pending'};
        });
        if(result.error)return ack(callback,{success:false,errorCode:'DRIVER_ACTION_SESSION_UNAVAILABLE',message:result.error});
        ack(callback,{success:true,...result});notify({driverId:payload.driverId,sessionId:payload.sessionId,deletionRequestUpdated:true});
      } catch (_) {ack(callback,{success:false,errorCode:'DRIVER_ACTION_DELETE_REQUEST_FAILED',message:'Session removal request could not be saved.'});}
    });

    socket.on('driver_actions:get_delete_requests', async (payload, callback) => {
      if(!ADMIN.has(role)||!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).length)return ack(callback,{success:false,errorCode:'DRIVER_ACTION_DELETE_QUEUE_DENIED',message:'Only an administrator can review session removal requests.'});
      try{const [rows]=await pool.execute("SELECT * FROM app_driver_action_delete_requests WHERE status='pending' ORDER BY requested_at_ms DESC LIMIT 100");
        ack(callback,{success:true,requests:rows.map(row=>({id:row.request_id,driverId:row.driver_id,sessionId:row.session_id,reason:row.reason,
          requestedBy:row.requested_by,requestedByRole:row.requested_by_role,requestedAt:timestamp(row.requested_at_ms),status:row.status,
          decidedBy:null,decidedAt:null,decisionReason:null}))});
      }catch(_){ack(callback,{success:false,errorCode:'DRIVER_ACTION_DELETE_QUEUE_FAILED',message:'Session removal requests are temporarily unavailable.'});}
    });

    socket.on('driver_actions:decide_delete', async (payload, callback) => {
      if(!ADMIN.has(role)||!validDeleteDecision(payload))return ack(callback,{success:false,errorCode:'DRIVER_ACTION_DELETE_DECISION_DENIED',message:'Only an administrator can review this request.'});
      try{
        const result=await transaction(async connection=>{
          const [requests]=await connection.execute('SELECT * FROM app_driver_action_delete_requests WHERE request_id=? FOR UPDATE',[payload.requestId]);
          const request=requests[0];if(!request||request.status!=='pending')return {error:'This request is no longer pending.'};
          if(request.requested_by===uid)return {error:'A different administrator must review your request.'};
          const [sessions]=await connection.execute('SELECT * FROM app_driver_action_sessions WHERE session_id=? FOR UPDATE',[request.session_id]);
          const session=sessions[0];if(!session||session.driver_id!==request.driver_id||session.pending_deletion_request_id!==request.request_id||session.deleted_at_ms!=null)return {error:'The session no longer matches this request.'};
          const decidedAt=now();
          await connection.execute('UPDATE app_driver_action_delete_requests SET status=?,decided_by=?,decided_by_role=?,decided_at_ms=?,decision_reason=? WHERE request_id=?',
            [payload.decision,uid,role,decidedAt,payload.reason?.trim()||null,request.request_id]);
          if (payload.decision === 'approved') {
            await connection.execute('DELETE FROM app_driver_action_sessions WHERE session_id=?', [request.session_id]);
          } else {
            await connection.execute('UPDATE app_driver_action_sessions SET pending_deletion_request_id=NULL WHERE session_id=?', [request.session_id]);
          }
          return {driverId:request.driver_id,sessionId:request.session_id,status:payload.decision};
        });
        if(result.error)return ack(callback,{success:false,errorCode:'DRIVER_ACTION_DELETE_DECISION_CONFLICT',message:result.error});
        ack(callback,{success:true,...result});notify({driverId:result.driverId,sessionId:result.sessionId,deletionRequestUpdated:true});
      }catch(_){ack(callback,{success:false,errorCode:'DRIVER_ACTION_DELETE_DECISION_FAILED',message:'Session removal decision could not be saved.'});}
    });
  }

  return Object.freeze({bind});
}

module.exports = {createMysqlDriverActionAudit};
