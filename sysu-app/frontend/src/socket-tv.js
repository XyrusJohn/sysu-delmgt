import {io} from "socket.io-client";

export function initSocketTV(apiUrl, {onRefreshQR}) {
    try {
        const socket = io(apiUrl, {
            transports: ["websocket", "polling"],
            reconnectionDelay: 1000,
        });
        socket.on("connect", () => {});
        socket.on("qr_token_used", () => {
            if (onRefreshQR) onRefreshQR();
        });
        socket.on("disconnect", () => {});
    } catch (e) {
        console.error("TV socket init error:", e);
    }
}