import {AuthService} from './authService.js';
import {API_CONFIG} from './config.js';
import {fetchWithTimeout} from './fetchWithTimeout.js';
async function request(id, method, data) {
    if (typeof id !== 'string' || !id.trim()) throw new Error('Select a registered driver account first.');
    const token = await AuthService.getToken();
    const response = await fetchWithTimeout(`${API_CONFIG.BASE_URL}/api/drivers/${encodeURIComponent(id)}/profile`, {
        method, signal:AbortSignal.timeout(20000),
        headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`},
        ...(data ? {body:JSON.stringify(data)} : {}),
    });
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(body.message || 'Driver profile request failed.');
    return body;
}
export const StaffDriverService = {
    save:(id, data) => request(id, 'PUT', data),
    remove:id => request(id, 'DELETE'),
};
