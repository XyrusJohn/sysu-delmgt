import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { API_CONFIG } from '../api/config';
import {fetchWithTimeout} from '../api/fetchWithTimeout.js';
import { subscribeRealtime, asCollectionSnapshot } from '../api/realtimeService';
import './QRGenerator.css';

const QRGenerator = () => {
    const [token, setToken] = useState('————');
    const [isLive, setIsLive] = useState(false);
    const [qrLoading, setQrLoading] = useState(true);
    const [queueData, setQueueData] = useState({
        AUV: [], '4W': [], '6W': [], '10W': [], '20F': [], '40F': []
    });
    const [counts, setCounts] = useState({ AUV: 0, '4W': 0, '6W': 0, '10W': 0, '20F': 0, '40F': 0 });
    const [queueLoading, setQueueLoading] = useState(true);
    const [currentTime, setCurrentTime] = useState('');
    const canvasRef = useRef(null);
    const refreshingQR = useRef(false);

    //  Clock Logic
    useEffect(() => {
        const timer = setInterval(() => {
            const now = new Date();
            setCurrentTime(now.toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
            }));
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    //  QR Generation Logic
    const renderQRCode = async (text) => {
        if (!canvasRef.current) return;
        try {
            await QRCode.toCanvas(canvasRef.current, text, {
                width: 400,
                margin: 2,
                color: {
                    dark: '#000000',
                    light: '#ffffff',
                },
            });
        } catch (err) {
            console.error('QR Render Error:', err);
        }
    };

    const refreshQR = async () => {
        if (refreshingQR.current) return;
        refreshingQR.current = true;
        try {
            const res = await fetchWithTimeout(`${API_CONFIG.BASE_URL}/api/qr/generate`, {}, 10_000);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data.success && data.token) {
                setToken(data.token);
                setIsLive(true);
                renderQRCode(`${window.location.origin}/?token=${encodeURIComponent(data.token)}`);
            }
        } catch (err) {
            console.warn('QR API unreachable:', err.message);
            setIsLive(false);
            setToken('OFFLINE');
            renderQRCode(`${window.location.origin}/qr-generator`);
        } finally {
            refreshingQR.current = false;
            setQrLoading(false);
        }
    };

    useEffect(() => {
        refreshQR();
        const interval = setInterval(refreshQR, 30000);
        return () => clearInterval(interval);
    }, []);

    //  Queue Listener
    useEffect(() => {
        const unsubscribe = subscribeRealtime('queue', {order: 'desc', limit: 50}, (rows) => {
            const newQueue = { AUV: [], '4W': [], '6W': [], '10W': [], '20F': [], '40F': [] };
            const newCounts = { AUV: 0, '4W': 0, '6W': 0, '10W': 0, '20F': 0, '40F': 0 };

            asCollectionSnapshot(rows).docs.forEach((doc, index) => {
                const data = doc.data();
                const type = (data.truckType || '').toUpperCase();
                let key = null;
                if (type.includes('AUV')) key = 'AUV';
                else if (type.includes('4W')) key = '4W';
                else if (type.includes('6W')) key = '6W';
                else if (type.includes('10W')) key = '10W';
                else if (type.includes('20F')) key = '20F';
                else if (type.includes('40F')) key = '40F';

                if (key) {
                    newCounts[key]++;
                    newQueue[key].push({ ...data, id: doc.id, index });
                }
            });

            setQueueData(newQueue);
            setCounts(newCounts);
            setQueueLoading(false);
        }, () => setQueueLoading(false));
        return () => unsubscribe();
    }, []);

    const COLS = ['AUV', '4W', '6W', '10W', '20F', '40F'];

    return (
        <div className="qr-root">
            <header className="topbar">
                <div className="topbar-left">
                    <div className="logo-mark">
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                            <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                        </svg>
                    </div>
                    <div className="brand">SYSU <span>Queue</span> Command Center</div>
                </div>
                <div className="topbar-right">
                    <div className="live-badge">
                        <span className="live-dot"></span>
                        LIVE
                    </div>
                    <div id="clock">{currentTime}</div>
                </div>
            </header>

            <div className="qr-main-layout">
                <aside className="qr-panel">
                    <div className="qr-label">{qrLoading ? 'Preparing QR code' : isLive ? 'Scan me' : 'Offline mode'}</div>
                    <div className="qr-frame">
                        <div className="qr-corner-tr"></div>
                        <div className="qr-corner-bl"></div>
                        <div id="qr-box">
                            <canvas ref={canvasRef}></canvas>
                            {qrLoading && <div role="status" aria-label="Loading QR code" className="q-qr-skeleton" />}
                        </div>
                    </div>
                    <div id="qr-token-display">
                        {qrLoading ? <div role="status" aria-label="Loading QR token" className="q-skeleton-line q-skeleton-medium" /> :
                            <div className={`qr-token ${isLive ? 'is-live' : 'is-offline'}`}>{token}</div>}
                        <div className="qr-token-label">AUTH TOKEN</div>
                    </div>
                </aside>

                <div className="v-div"></div>

                <main className="queue-section">
                    {COLS.map(col => (
                        <div key={col} className={`q-col ${queueData[col].some(d => d.status === 'loading') ? 'has-active' : ''}`}>
                            <div className="q-col-head">
                                <span className="q-col-name">{col}</span>
                                <span className="q-col-count">{queueLoading ? '…' : counts[col]}</span>
                            </div>
                            <div className="q-col-body">
                                {queueLoading ? (
                                    <div role="status" aria-label={`Loading ${col} queue`} aria-busy="true" className="q-skeleton-stack">
                                        {[0, 1].map(index => <div key={index} className="q-card q-skeleton-card" aria-hidden="true">
                                            <div className="q-skeleton-line q-skeleton-short" />
                                            <div className="q-skeleton-line" />
                                            <div className="q-skeleton-line q-skeleton-medium" />
                                        </div>)}
                                    </div>
                                ) : queueData[col].length === 0 ? (
                                    <div className="no-drivers">No drivers</div>
                                ) : (
                                    queueData[col].map((driver, idx) => (
                                        <div key={driver.id} className={`q-card ${driver.status === 'loading' ? 'active' : ''}`}>
                                            <div className="q-card-top">
                                                <span className="q-num">#{String(idx + 1).padStart(3, '0')}</span>
                                                <span className={`q-status ${driver.status === 'loading' ? 'loading' : ''}`}>
                                                    {driver.status || 'waiting'}
                                                </span>
                                            </div>
                                            <div className="q-name">{driver.driverName || driver.driverId || 'Unknown Driver'}</div>
                                            <div className="q-plate">
                                                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/>
                                                </svg>
                                                {driver.plateNumber || '—'}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    ))}
                </main>
            </div>
        </div>
    );
};

export default QRGenerator;
