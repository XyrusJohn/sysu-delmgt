const STAFF = new Set(["fleet_manager", "admin", "super_admin"]);
const ADMIN_ROLES = new Set(["admin", "super_admin"]);
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

function serialize(value) {
    if (value && typeof value.toMillis === "function") return {$timestamp: value.toMillis()};
    if (Array.isArray(value)) return value.map(serialize);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
    }
    return value;
}

function createRealtimeSubscriptions({mysqlMasterData, masterDataEvents, mysqlRoleGovernance, mysqlDriverProfiles, mysqlQrService, mysqlLiveLocations, mysqlAssignments, mysqlDispatchGovernance}) {
    return function bindRealtimeSubscriptions(socket) {
        const subscriptions = new Map();
        const stopAll = () => {
            for (const stop of subscriptions.values()) stop();
            subscriptions.clear();
        };
        socket.on("realtime:subscribe", (request, acknowledge) => {
            const ack = typeof acknowledge === "function" ? acknowledge : () => {};
            if (!request || typeof request !== "object" || Array.isArray(request)
                || !ID_PATTERN.test(request.id || "") || typeof request.topic !== "string") {
                ack({success: false, message: "Invalid subscription"});
                return;
            }
            const {id, topic, params = {}} = request;
            if (!params || typeof params !== "object" || Array.isArray(params)
                || Buffer.byteLength(JSON.stringify(params)) > 512 || subscriptions.has(id)
                || subscriptions.size >= 20) {
                ack({success: false, message: "Invalid or excessive subscription"});
                return;
            }
            const role = socket.data.role;
            const uid = socket.data.uid;
            const mysqlMasterTopic = mysqlMasterData && (topic === 'securityGuards' || topic === 'truckCompanies');
            const mysqlUsersTopic = mysqlRoleGovernance && topic === 'users';
            const mysqlDriversTopic = mysqlDriverProfiles && topic === 'drivers';
            const mysqlQueueTopic = mysqlQrService && topic === 'queue';
            const mysqlLocationsTopic = mysqlLiveLocations && topic === 'locations';
            const mysqlAssignmentsTopic = mysqlAssignments && topic === 'assignments';
            const mysqlDispatchTopic = mysqlDispatchGovernance && (topic === 'overrideRequests' || topic === 'cancelRequests');
            if (mysqlMasterTopic || mysqlUsersTopic || mysqlDriversTopic || mysqlQueueTopic || mysqlLocationsTopic || mysqlAssignmentsTopic || mysqlDispatchTopic) {
                const permitted = mysqlMasterTopic ? ADMIN_ROLES.has(role)
                    : mysqlUsersTopic ? STAFF.has(role)
                        : mysqlDispatchTopic ? STAFF.has(role)
                        : mysqlQueueTopic ? STAFF.has(role) || role === 'qr_generator'
                            : STAFF.has(role) || role === 'driver';
                if (!permitted) {
                    ack({success: false, message: 'Subscription not authorized'});
                    return;
                }
                let last = null;
                let inFlight = false;
                let failureNotified = false;
                const refresh = async () => {
                    if (inFlight) return;
                    inFlight = true;
                    try {
                        const rows = mysqlAssignmentsTopic
                            ? await mysqlAssignments.list(role === 'driver' ? {driverId: uid} : {})
                            : mysqlDispatchTopic ? await mysqlDispatchGovernance.listRequests(topic === 'cancelRequests' ? 'cancel' : 'override')
                            : mysqlLocationsTopic
                            ? (role === 'driver' ? await mysqlLiveLocations.get(uid) : await mysqlLiveLocations.list())
                            : mysqlDriversTopic
                            ? (role === 'driver' ? await mysqlDriverProfiles.get(uid) : await mysqlDriverProfiles.list())
                            : mysqlQueueTopic ? await mysqlQrService.listAll({
                                limit: role === 'qr_generator' ? 50 : 100,
                                order: params.order === 'desc' ? 'desc' : 'asc'})
                            : mysqlUsersTopic ? await mysqlRoleGovernance.listUsers()
                            : topic === 'securityGuards'
                                ? await mysqlMasterData.listGuards() : await mysqlMasterData.listCompanies();
                        const fields = topic === 'securityGuards'
                            ? ['id', 'guardId', 'firstName', 'middleInitial', 'lastName', 'fullName', 'active']
                            : ['id', 'companyCode', 'forwarderCode', 'name', 'active'];
                        const data = mysqlQueueTopic && role === 'qr_generator'
                            ? rows.map(({id: queueId, driverId, driverName, plateNumber, truckType, status, entryTime}) =>
                                ({id: queueId, driverId, driverName, plateNumber, truckType, status, entryTime}))
                            : mysqlUsersTopic || mysqlDriversTopic || mysqlQueueTopic || mysqlLocationsTopic || mysqlAssignmentsTopic || mysqlDispatchTopic ? rows
                            : rows.map(row => Object.fromEntries(fields.map(field => [field, row[field]])));
                        const serialized = JSON.stringify(data);
                        const recovered = failureNotified;
                        failureNotified = false;
                        if ((recovered || last !== serialized) && subscriptions.has(id)) {
                            last = serialized;
                            socket.emit('realtime:state', {id, topic, data});
                        }
                    } catch {
                        if (!failureNotified && subscriptions.has(id)) {
                            failureNotified = true;
                            socket.emit('realtime:error', {id, topic, message: 'Realtime data unavailable'});
                        }
                    } finally {
                        inFlight = false;
                    }
                };
                const timer = setInterval(refresh, mysqlQueueTopic ? 3000 : 5000);
                timer.unref?.();
                if (mysqlMasterTopic) masterDataEvents?.on(topic, refresh);
                subscriptions.set(id, () => {
                    clearInterval(timer);
                    if (mysqlMasterTopic) masterDataEvents?.off(topic, refresh);
                });
                ack({success: true, id, topic});
                void refresh();
                return;
            }
            ack({success: false, message: "Realtime topic is unavailable"});
        });
        socket.on("realtime:unsubscribe", (request, acknowledge) => {
            const ack = typeof acknowledge === "function" ? acknowledge : () => {};
            const id = request?.id;
            const stop = ID_PATTERN.test(id || "") ? subscriptions.get(id) : null;
            if (stop) {
                stop();
                subscriptions.delete(id);
            }
            ack({success: true});
        });
        socket.once("disconnect", stopAll);
    };
}

function createMysqlProfileRealtimeSubscriptions({authenticateSession}) {
    return function bindMysqlProfileRealtimeSubscriptions(socket) {
        let subscription = null;
        const stop = () => {
            if (subscription) clearInterval(subscription.timer);
            subscription = null;
        };
        socket.on('realtime:subscribe', (request, acknowledge) => {
            const ack = typeof acknowledge === 'function' ? acknowledge : () => {};
            if (!request || typeof request !== 'object' || Array.isArray(request)
                || !ID_PATTERN.test(request.id || '') || request.topic !== 'profile'
                || (request.params != null && (typeof request.params !== 'object'
                    || Array.isArray(request.params) || Object.keys(request.params).length !== 0))
                || subscription) {
                ack({success: false, message: 'Invalid profile subscription'});
                return;
            }
            const current = {id: request.id, last: null, timer: null, inFlight: false};
            subscription = current;
            const refresh = async () => {
                if (current.inFlight) return;
                current.inFlight = true;
                try {
                    const user = await authenticateSession(socket.handshake.auth.token);
                    if (!user || user.id !== socket.data.uid) return socket.disconnect(true);
                    if (subscription !== current) return;
                    const data = {...user.profile, id: user.id, username: user.username,
                        displayName: user.displayName, role: user.role, status: user.status};
                    const serialized = JSON.stringify(data);
                    if (serialized !== current.last) {
                        current.last = serialized;
                        socket.emit('realtime:state', {id: current.id, topic: 'profile', data});
                    }
                } catch {
                    socket.emit('realtime:error', {id: current.id, topic: 'profile', message: 'Profile unavailable'});
                    socket.disconnect(true);
                } finally {
                    current.inFlight = false;
                }
            };
            current.timer = setInterval(refresh, 30000);
            current.timer.unref?.();
            ack({success: true, id: current.id, topic: 'profile'});
            void refresh();
        });
        socket.on('realtime:unsubscribe', (request, acknowledge) => {
            if (subscription && request?.id === subscription.id) stop();
            if (typeof acknowledge === 'function') acknowledge({success: true});
        });
        socket.once('disconnect', stop);
    };
}

module.exports = {createRealtimeSubscriptions, createMysqlProfileRealtimeSubscriptions, serialize};
