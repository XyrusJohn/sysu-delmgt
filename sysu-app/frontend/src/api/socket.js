import {io} from "socket.io-client";
import {API_CONFIG} from "./config.js";
import {getSessionToken, onSessionChange} from "./sessionStore.js";

let _driverSocket = null;
let driverConnectionRequested = false;

const currentTokenAuth = async (callback) => {
    const token = getSessionToken();
    callback(token ? {token} : {});
};

export const socket = io(API_CONFIG.SOCKET_URL, {
    autoConnect: false, // Don't connect until we have a token
    reconnection: true,
    auth: currentTokenAuth,
});

const connectAuthenticated = (target) => {
    if (!getSessionToken()) {
        target.disconnect();
        return;
    }
    target.connect();
};

export const connectSocket = () => connectAuthenticated(socket);
export const connectDriverSocket = () => {
    driverConnectionRequested = true;
    return connectAuthenticated(getDriverSocket());
};
export const getExistingDriverSocket = () => _driverSocket;

onSessionChange(token => {
    const reconnectDriver = driverConnectionRequested || _driverSocket?.active || _driverSocket?.connected;
    socket.disconnect();
    _driverSocket?.disconnect();
    if (!token) { driverConnectionRequested = false; return; }
    socket.connect();
    if (reconnectDriver) _driverSocket?.connect();
});

if (getSessionToken()) socket.connect();

socket.on("connect", () => {
    //  Socket connected silently in production
});

socket.on("connect_error", (err) => {
    console.error("Socket connection error:", err.message);
});

socket.on("disconnect", () => {
    //  Silently disconnected
});

export const EVENTS = {
    DRIVER_MOVING: "update_admin_map",
    STATUS_UPDATE: "vendor_status_update",
    WAREHOUSE_BASE_UPDATED: "warehouse_base_updated",
    SAVE_WAREHOUSE_BASE: "save_warehouse_base",
    GET_WAREHOUSE_BASE: "get_warehouse_base",
    ROLE_REQUEST_CREATED: "role_request_created",
    ROLE_REQUEST_UPDATED: "role_request_updated",
    GET_ROLE_REQUESTS: "get_role_requests",
    CREATE_ROLE_REQUEST: "create_role_request",
    APPROVE_ROLE_REQUEST: "approve_role_request",
    REJECT_ROLE_REQUEST: "reject_role_request",
    USER_ROLE_CHANGED: "user_role_changed",
    POD_UPDATED: "pod_updated",
    DRIVER_ACTIONS_GET_SESSIONS: "driver_actions:get_sessions",
    DRIVER_ACTIONS_GET_EVENTS: "driver_actions:get_events",
    DRIVER_ACTIONS_SEARCH_SHIPMENT: "driver_actions:search_shipment",
    DRIVER_ACTIONS_REQUEST_DELETE: "driver_actions:request_delete",
    DRIVER_ACTIONS_GET_DELETE_REQUESTS: "driver_actions:get_delete_requests",
    DRIVER_ACTIONS_DECIDE_DELETE: "driver_actions:decide_delete",
    DRIVER_ACTIONS_UPDATED: "driver_actions:updated",
};

//  Driver-Location Socket
//  Secondary socket that connects directly to the driver-app server
//  (VITE_DRIVER_TRACKING_URL) and receives driver_moving / update_status events.
//  Sysu-app's main socket connects to sysu-app's own backend and carries
//  vendor/assignment events (update_admin_map, vendor_status_update).
//  These two sockets operate independently and can coexist.
//

export const getDriverSocket = () => {
    if (_driverSocket) return _driverSocket;

    _driverSocket = io(API_CONFIG.DRIVER_TRACKING_URL, {
        autoConnect: false,
        reconnection: true,
        reconnectionDelayMax: 10000,
        auth: currentTokenAuth,
    });

    return _driverSocket;
};
