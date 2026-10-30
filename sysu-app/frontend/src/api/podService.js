import {API_CONFIG} from './config.js';
import {AuthService} from './authService.js';
import {fetchWithTimeout} from './fetchWithTimeout.js';

const base = (import.meta.env.VITE_SYSU_GO_API_URL || API_CONFIG.BASE_URL).replace(/\/$/, '');

export const PodService = Object.freeze({
    async getPod(shipmentId, obdNumber) {
        const token = await AuthService.getToken();
        const response = await fetchWithTimeout(`${base}/api/pod/${encodeURIComponent(shipmentId)}/${encodeURIComponent(obdNumber)}`, {
            headers: {Authorization: `Bearer ${token}`},
        }, 20_000);
        let body;
        try {body = await response.json();} catch {body = null;}
        if (!response.ok || body?.success !== true) throw new Error(body?.message || `POD unavailable (${response.status})`);
        return body.data;
    },
});
