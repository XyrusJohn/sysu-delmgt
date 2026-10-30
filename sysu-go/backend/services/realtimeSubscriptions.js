const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const MASTER_DATA_FIELDS = {
  securityGuards: ["guardId", "firstName", "middleInitial", "lastName", "fullName", "active"],
  truckCompanies: ["companyCode", "forwarderCode", "name", "active"],
};
function bindRealtimeSubscriptions(socket, {mysqlMasterData, mysqlDriverProfiles, mysqlAuthService, mysqlQrService, mysqlAssignments, mysqlLiveLocations} = {}) {
  const subscriptions = new Map();
  const stopAll = () => {
    for (const stop of subscriptions.values()) stop();
    subscriptions.clear();
  };
  socket.on("realtime:subscribe", async (request, acknowledge) => {
    const ack = typeof acknowledge === "function" ? acknowledge : () => {};
    if (!request || typeof request !== "object" || Array.isArray(request)
      || !ID_PATTERN.test(request.id || "") || subscriptions.has(request.id) || subscriptions.size >= 10) {
      ack({success: false, message: "Invalid subscription"});
      return;
    }
    const uid = socket.data.uid;
    if ((mysqlAssignments && request.topic === 'assignments')
      || (mysqlLiveLocations && request.topic === 'location')) {
      let last = null;
      let inFlight = false;
      const refresh = async () => {
        if (inFlight) return;
        inFlight = true;
        try {
          const data = request.topic === 'assignments'
            ? await mysqlAssignments.listOwn(uid) : await mysqlLiveLocations.get(uid);
          const serialized = JSON.stringify(data);
          if (last !== serialized && subscriptions.has(request.id)) {
            last = serialized;
            socket.emit('realtime:state', {id: request.id, topic: request.topic, data});
          }
        } catch {
          socket.emit('realtime:error', {id: request.id, topic: request.topic, message: 'Realtime data unavailable'});
        } finally {
          inFlight = false;
        }
      };
      const timer = setInterval(refresh, 3000);
      timer.unref?.();
      subscriptions.set(request.id, () => clearInterval(timer));
      ack({success: true, id: request.id, topic: request.topic});
      void refresh();
      return;
    }
    if (mysqlQrService && ['queue', 'queuePosition'].includes(request.topic)) {
      const queueId = request.params?.queueId;
      if (request.topic === 'queuePosition' || queueId != null) {
        if (typeof queueId !== 'string' || !ID_PATTERN.test(queueId)) {
          ack({success: false, message: 'Invalid queue session'});
          return;
        }
        try {
          const own = await mysqlQrService.get(queueId);
          if (!own || own.driverId !== uid) {
            ack({success: false, message: 'Subscription not authorized'});
            return;
          }
        } catch {
          ack({success: false, message: 'Queue unavailable'});
          return;
        }
      }
      let last = null;
      let inFlight = false;
      const refresh = async () => {
        if (inFlight) return;
        inFlight = true;
        try {
          const data = request.topic === 'queuePosition'
            ? await mysqlQrService.ownPosition(uid, queueId)
            : queueId ? await mysqlQrService.get(queueId) : await mysqlQrService.listOwn(uid);
          if (queueId && request.topic === 'queue' && data?.driverId !== uid) return socket.disconnect(true);
          const serialized = JSON.stringify(data);
          if (last !== serialized && subscriptions.has(request.id)) {
            last = serialized;
            socket.emit('realtime:state', {id: request.id, topic: request.topic, data});
          }
        } catch {
          socket.emit('realtime:error', {id: request.id, topic: request.topic, message: 'Queue unavailable'});
        } finally {
          inFlight = false;
        }
      };
      const timer = setInterval(refresh, 3000);
      timer.unref?.();
      subscriptions.set(request.id, () => clearInterval(timer));
      ack({success: true, id: request.id, topic: request.topic});
      void refresh();
      return;
    }
    if ((mysqlDriverProfiles && request.topic === 'driver') || (mysqlAuthService && request.topic === 'profile')) {
      let last = null;
      let inFlight = false;
      const refresh = async () => {
        if (inFlight) return;
        inFlight = true;
        try {
          const data = request.topic === 'driver'
            ? await mysqlDriverProfiles.get(uid)
            : await mysqlAuthService.authenticate(socket.data.token);
          if (request.topic === 'profile' && (!data || data.id !== uid)) return socket.disconnect(true);
          const payload = request.topic === 'profile'
            ? {...data.profile, id: data.id, uid: data.id, username: data.username,
                displayName: data.displayName, role: data.role, status: data.status}
            : data;
          const serialized = JSON.stringify(payload);
          if (last !== serialized && subscriptions.has(request.id)) {
            last = serialized;
            socket.emit('realtime:state', {id: request.id, topic: request.topic, data: payload});
          }
        } catch {
          socket.emit('realtime:error', {id: request.id, topic: request.topic, message: 'Realtime data unavailable'});
        } finally {
          inFlight = false;
        }
      };
      const timer = setInterval(refresh, 5000);
      timer.unref?.();
      subscriptions.set(request.id, () => clearInterval(timer));
      ack({success: true, id: request.id, topic: request.topic});
      void refresh();
      return;
    }
    if (mysqlMasterData && Object.hasOwn(MASTER_DATA_FIELDS, request.topic)) {
      let last = null;
      let inFlight = false;
      const refresh = async () => {
        if (inFlight) return;
        inFlight = true;
        try {
          const data = request.topic === 'securityGuards'
            ? await mysqlMasterData.listGuards() : await mysqlMasterData.listCompanies();
          const serialized = JSON.stringify(data);
          if (last !== serialized && subscriptions.has(request.id)) {
            last = serialized;
            socket.emit('realtime:state', {id: request.id, topic: request.topic, data});
          }
        } catch {
          socket.emit('realtime:error', {id: request.id, topic: request.topic, message: 'Realtime data unavailable'});
        } finally {
          inFlight = false;
        }
      };
      const timer = setInterval(refresh, 5000);
      timer.unref?.();
      subscriptions.set(request.id, () => clearInterval(timer));
      ack({success: true, id: request.id, topic: request.topic});
      void refresh();
      return;
    }
    ack({success: false, message: "Realtime topic is unavailable"});
  });
  socket.on("realtime:unsubscribe", (request, acknowledge) => {
    const ack = typeof acknowledge === "function" ? acknowledge : () => {};
    const stop = ID_PATTERN.test(request?.id || "") ? subscriptions.get(request.id) : null;
    if (stop) {
      stop();
      subscriptions.delete(request.id);
    }
    ack({success: true});
  });
  socket.once("disconnect", stopAll);
}

module.exports = {bindRealtimeSubscriptions};
