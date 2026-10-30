import React from 'react';
import { useFleetQueue } from '../../hooks/useFleetQueue';

/**
 * DriverQueueCard Component
 * Individual driver card within the Fleet Manager queue.
 */
const DriverQueueCard = ({ driver, rank }) => {
    const { name, plateNumber, truckType, entryTime, status } = driver;

    const statusConfig = {
        loading: { badge: 'Loading', color: 'text-sysu-red', bg: 'bg-sysu-red/10', border: 'border-sysu-red/30' },
        called: { badge: 'Loading', color: 'text-sysu-red', bg: 'bg-sysu-red/10', border: 'border-sysu-red/30' },
        complete: { badge: 'Complete', color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/30' },
        default: { badge: 'Queued', color: 'text-db-text3', bg: 'bg-db-text3/10', border: 'border-db-text3/20' },
    };

    const config = statusConfig[status] || statusConfig.default;
    const phone = driver.phone || driver.driverPhone || "";
    const viberHref = phone ? `viber://contact?number=${phone.replace(/^0/, "63")}` : "#";

    return (
        <div
            className="rounded-xl border border-white/10 bg-[#13161b] p-4 transition-all hover:border-blue-500/50 hover:shadow-lg cursor-pointer group"
            onClick={undefined}
        >
            <div className="flex items-start justify-between mb-3">
                <div className="flex flex-col">
                    <span className="text-[9px] font-mono uppercase tracking-widest text-db-text3 opacity-50">Queue</span>
                    <span className={`text-lg font-bold font-mono leading-none ${rank === 1 ? 'text-sysu-red' : rank === 2 ? 'text-yellow-400' : 'text-db-text'}`}>
                        #{rank}
                    </span>
                </div>
                <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${config.bg} ${config.color} ${config.border}`}>
                    {config.badge}
                </span>
            </div>

            <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-sysu-red/10 border border-sysu-red/20 flex items-center justify-center text-sysu-red font-bold text-sm shrink-0">
                    {(name || "?")[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-db-text truncate">{name || "—"}</div>
                    <div className="text-[10px] font-mono text-db-text3 opacity-60">{plateNumber || "—"}</div>
                </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-white/5">
                <div className="flex items-center gap-1.5 text-[9px] text-db-text3 opacity-50">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
                    </svg>
                    {truckType || "—"}
                </div>
                <a
                    href={viberHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all shrink-0 ${
                        phone ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-db-item-hover opacity-50 cursor-not-allowed text-db-text3'
                    }`}
                >
                    Viber
                </a>
            </div>
        </div>
    );
};

/**
 * FleetColumn Component
 * A single column of drivers for a specific truck type.
 */
const FleetColumn = ({ type, drivers, icon }) => {
    return (
        <div className="flex flex-col gap-3 min-w-[320px] max-w-[350px]">
            <div className="flex items-center gap-2 mb-1 px-1">
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${type === 'AUV' ? 'bg-amber-400' : type === '4W' ? 'bg-sky-400' : 'bg-db-text3'}`} />
                <div className="w-7 h-7 rounded-lg bg-db-bg border border-db-border flex items-center justify-center shrink-0 text-db-text3">
                    {icon}
                </div>
                <span className="text-sm font-bold uppercase tracking-widest text-db-text">{type}</span>
                <div className="flex-1 h-px bg-white/10 opacity-30"></div>
                <span className="font-mono text-xs font-semibold text-blue-400 bg-blue-400/10 border border-blue-400/20 rounded-full px-2 py-0.5">
                    {drivers.length} queued
                </span>
            </div>

            {drivers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-white/5 bg-white/5 text-center">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-db-text3 opacity-30 mb-2">
                        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
                    </svg>
                    <span className="text-[11px] text-db-text3 opacity-40">No orders</span>
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {drivers.map((d, i) => (
                        <DriverQueueCard key={d.id} driver={d} rank={i + 1} />
                    ))}
                </div>
            )}
        </div>
    );
};

/**
 * FleetManagerView Component
 * The main view for managing the driver queue.
 */
const FleetManagerView = () => {
    const { groupedQueue, loading } = useFleetQueue();

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full text-db-text3 italic">
                Loading fleet queue...
            </div>
        );
    }

    const TRUCK_ICONS = {
        "AUV": <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="7.5" cy="18" r="1.5"/><circle cx="16.5" cy="18" r="1.5"/></svg>,
        "4W": <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="12" height="9"/><circle cx="6.5" cy="17.5" r="1.5"/><circle cx="13.5" cy="17.5" r="1.5"/></svg>,
        "6W": <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
        "10W": <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
        "20F": <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>,
        "40F": <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>,
        "Reefer": <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M2 10h20M12 4v6M12 10v6"/></svg>,
        "Unknown": <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
    };

    return (
        <div className="p-6 h-full flex flex-col">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-db-text font-display">Driver Fleet Queue</h1>
                    <p className="text-xs text-db-text3 mt-1">Real-time FIFO priority board for assignment</p>
                </div>
                <div className="flex gap-2">
                    <div className="px-3 py-1 rounded-full bg-db-panel border border-db-border text-[11px] font-bold text-db-text3 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                        LIVE SYNC
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-x-auto">
                <div className="flex flex-wrap gap-6 w-max pb-6">
                    {Object.entries(groupedQueue).map(([type, drivers]) => (
                        <FleetColumn
                            key={type}
                            type={type}
                            drivers={drivers}
                            icon={TRUCK_ICONS[type] || TRUCK_ICONS.Unknown}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
};

export default FleetManagerView;
