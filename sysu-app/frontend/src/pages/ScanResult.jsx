import React, { useState, useEffect } from 'react';
import { API_CONFIG } from '../api/config';
import {fetchWithTimeout} from '../api/fetchWithTimeout.js';
import './ScanResult.css';

const ScanResult = () => {
    const [state, setState] = useState('scanning'); // 'scanning', 'success', 'error'
    const [errorDetails, setErrorDetails] = useState({ title: '', msg: '' });
    const [token, setToken] = useState('');

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const tokenParam = urlParams.get('token');

        if (!tokenParam) {
            showError('No Token', 'No token found in URL. Please scan the QR code again.');
            return;
        }

        setToken(tokenParam);
        verifyToken(tokenParam);
    }, []);

    const verifyToken = async (tokenValue) => {
        setState('scanning');
        try {
            const res = await fetchWithTimeout(`${API_CONFIG.BASE_URL}/api/qr/verify?token=${encodeURIComponent(tokenValue)}`, {}, 8_000);

            if (res.ok) {
                setState('success');
            } else if (res.status === 410) {
                const data = await res.json().catch(() => ({}));
                showError('QR Expired', data.message || 'This QR has expired. Please get a new one from the yard TV.');
            } else if (res.status === 404) {
                showError('Invalid QR', 'This QR code is not recognized. Please scan the QR from the yard TV.');
            } else {
                const data = await res.json().catch(() => ({}));
                showError('Verification Failed', data.message || 'Could not verify this QR code. Please try again.');
            }
        } catch (e) {
            showError(e?.code === 'REQUEST_TIMEOUT' ? 'Server Taking Too Long' : 'Connection Error',
                e?.code === 'REQUEST_TIMEOUT'
                    ? 'The server did not answer in time. Check your connection, then scan again.'
                    : 'Cannot reach the server. Make sure you have internet connection and try again.');
        }
    };

    const showError = (title, msg) => {
        setErrorDetails({ title, msg });
        setState('error');
    };

    return (
        <div className="scan-result-container">
            <div className="logo">SYSU <span>Queue</span></div>

            <div className="result-card">
                {/* Scanning state */}
                <div className={`state ${state === 'scanning' ? 'active' : ''}`}>
                    <div className="scan-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/>
                            <path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
                            <line x1="7" y1="12" x2="17" y2="12"/>
                        </svg>
                    </div>
                    <div className="state-label">Verifying QR Code…</div>
                    <div className="state-sub">Please hold your phone steady</div>
                </div>

                {/* Success state */}
                <div className={`state ${state === 'success' ? 'active' : ''}`}>
                    <div className="success-wrapper">
                        <div className="pulse-ring"></div>
                        <div className="success-icon">
                            <svg viewBox="0 0 24 24">
                                <path d="M20 6L9 17l-5-5"/>
                            </svg>
                        </div>
                    </div>
                    <div className="success-title">You're in the queue!</div>
                    <div className="success-sub">The yard team has received your spot.<br />Please proceed to the loading zone.</div>
                    <div className="token-tag">{token}</div>
                </div>

                {/* Error state */}
                <div className={`state ${state === 'error' ? 'active' : ''}`}>
                    <div className="error-icon">
                        <svg viewBox="0 0 24 24" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </div>
                    <div className="error-title">{errorDetails.title}</div>
                    <div className="error-msg">{errorDetails.msg}</div>
                    <button className="try-again-btn" onClick={() => verifyToken(token)}>Scan Again</button>
                </div>
            </div>
        </div>
    );
};

export default ScanResult;
