import {API_CONFIG} from '../api/config.js';

export async function mountScanResult({document, search, baseUrl, fetcher}) {
    const token = new URLSearchParams(search).get('token');
    const states = ['state-scanning', 'state-success', 'state-error'];
    let pending = false;
    function show(state) {
        for (const id of states) document.getElementById(id).classList.toggle('active', id === state);
    }
    function error(title, message) {
        document.getElementById('err-title').textContent = title;
        document.getElementById('err-msg').textContent = message;
        show('state-error');
    }
    async function verify() {
        if (pending) return;
        if (!token || token.length > 512) {
            error('Invalid Token', 'Scan a valid QR code again.');
            return;
        }
        pending = true;
        show('state-scanning');
        try {
            const response = await fetcher(`${baseUrl}/api/qr/verify?token=${encodeURIComponent(token)}`,
                {method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(8000)});
            if (response.ok) {
                document.querySelector('.success-title').textContent = 'QR verified';
                document.querySelector('.success-sub').textContent = 'Complete queue admission in the authenticated driver app. Verification alone does not reserve a queue position.';
                document.getElementById('verified-token').textContent = '';
                show('state-success');
            } else if (response.status === 410) {
                error('QR Expired', 'Get a new QR code from the yard display.');
            } else if (response.status === 404) {
                error('Invalid QR', 'Scan the QR code from the yard display.');
            } else {
                error('Verification Failed', 'Unable to verify this QR code. Try again.');
            }
        } catch {
            error('Connection Error', 'Unable to reach the server. Check your connection and try again.');
        } finally {
            pending = false;
        }
    }
    document.getElementById('retryBtn').addEventListener('click', verify);
    return verify();
}

if (typeof document !== 'undefined' && document.getElementById('state-scanning')) {
    void mountScanResult({document, search: window.location.search, baseUrl: API_CONFIG.BASE_URL,
        fetcher: window.fetch.bind(window)});
}
