import React, { useState } from 'react';
import { useSapStore } from '../../hooks/useSapStore';

/**
 * SapStatsBar Component
 * Displays KPI totals for the SAP shipment table.
 */
const SapStatsBar = ({ total, delivered, transit }) => {
    return (
        <div className="grid grid-cols-3 gap-4 mb-6">
            {[
                { label: 'Total Dispatches', value: total, color: 'text-db-text', bg: 'bg-db-panel' },
                { label: 'Delivered', value: delivered, color: 'text-green-400', bg: 'bg-green-500/10' },
                { label: 'In Transit', value: transit, color: 'text-sysu-gold', bg: 'bg-sysu-gold/10' },
            ].map((stat, i) => (
                <div key={i} className={`${stat.bg} border border-db-border p-4 rounded-2xl flex flex-col items-center justify-center shadow-sm`}>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-db-text3 mb-1">{stat.label}</span>
                    <span className={`text-2xl font-black font-mono ${stat.color}`}>{stat.value}</span>
                </div>
            ))}
        </div>
    );
};

/**
 * SapShipmentTable Component
 * The main data grid for SAP shipments with sorting and assignment triggers.
 */
const SapShipmentTable = ({
    shipments,
    assignments,
    sortKey,
    sortDir,
    onSort,
    onAssign
}) => {
    const sortedData = shipments
        .map(s => ({ id: s.SAPDispatchNumber, ...s }))
        .sort((a, b) => {
            const valA = a[sortKey] || '';
            const valB = b[sortKey] || '';
            return valA < valB ? -sortDir : valA > valB ? sortDir : 0;
        });

    return (
        <div className="overflow-x-auto rounded-2xl border border-db-border bg-db-panel/30 backdrop-blur-sm">
            <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-db-panel text-db-text3 text-[10px] font-black uppercase tracking-widest border-b border-db-border">
                    <tr>
                        <th className="px-6 py-3"># Dispatch</th>
                        <th className="px-6 py-3 cursor-pointer hover:text-sysu-red transition-colors" onClick={() => onSort('TruckType')}>
                            Truck Type {sortKey === 'TruckType' ? (sortDir === 1 ? '↑' : '↓') : ''}
                        </th>
                        <th className="px-6 py-3">Route</th>
                        <th className="px-6 py-3 cursor-pointer hover:text-sysu-red transition-colors" onClick={() => onSort('PlanningDate')}>
                            Planning Date {sortKey === 'PlanningDate' ? (sortDir === 1 ? '↑' : '↓') : ''}
                        </th>
                        <th className="px-6 py-3">Status</th>
                        <th className="px-6 py-3">Driver</th>
                        <th className="px-6 py-3 text-right">Action</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-db-border/50">
                    {sortedData.map((shipment) => {
                        const asgn = assignments[shipment.id];
                        const status = shipment.PgiStatus || shipment.CheckStatus || 'Pending';
                        const isDelivered = status.toUpperCase() === 'DELIVERED' || asgn?.tripStatus?.toLowerCase() === 'completed';

                        return (
                            <tr key={shipment.id} className="hover:bg-db-item-hover transition-colors group">
                                <td className="px-6 py-4 font-mono font-bold text-db-text text-xs">
                                    #{shipment.id.replace(/^0+/, '') || shipment.id}
                                </td>
                                <td className="px-6 py-4 text-db-text2 text-xs uppercase">{shipment.TruckType || '—'}</td>
                                <td className="px-6 py-4 text-db-text2 text-xs truncate max-w-xs">
                                    {(shipment.Route || '').split('-->').pop()?.trim() || '—'}
                                </td>
                                <td className="px-6 py-4 text-db-text2 font-mono text-xs">
                                    {shipment.PlanningDate || shipment.Planning_Date || '—'}
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase border ${
                                        isDelivered ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-sysu-gold/10 text-sysu-gold border-sysu-gold/30'
                                    }`}>
                                        {status}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    {asgn ? (
                                        <div className="flex flex-col">
                                            <span className="text-xs font-bold text-db-text">{asgn.driverName || '—'}</span>
                                            <span className="text-[10px] text-db-text3 font-mono">{asgn.truckPlate || '—'}</span>
                                        </div>
                                    ) : (
                                        <span className="text-xs text-db-text3 italic">Unassigned</span>
                                    )}
                                </td>
                                <td className="px-6 py-4 text-right">
                                    {asgn ? (
                                        asgn.tripStatus?.toLowerCase() === 'assigned' ? (
                                            <div className="flex gap-1 justify-end">
                                                <button className="px-2 py-1 text-[10px] font-bold uppercase bg-db-bg border border-db-border text-db-text3 hover:text-sysu-red rounded transition-colors">Cancel</button>
                                                <button className="px-2 py-1 text-[10px] font-bold uppercase bg-db-bg border border-db-border text-db-text3 hover:text-sysu-red rounded transition-colors">Change</button>
                                            </div>
                                        ) : (
                                            <span className="text-[10px] font-bold uppercase text-db-text3 opacity-60">In Progress</span>
                                        )
                                    ) : (
                                        <button
                                            onClick={() => onAssign(shipment.id, shipment.TruckType)}
                                            className="bg-sysu-red/10 hover:bg-sysu-red/20 text-sysu-red px-3 py-1.5 rounded-md text-xs font-bold transition-all"
                                        >
                                            ASSIGN
                                        </button>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

/**
 * SAPView Component
 * The main view for managing SAP shipments.
 */
const SAPView = () => {
    const {
        shipments,
        assignments,
        loading,
        refreshShipments,
        //  We'll lift sorting/filtering to local state or a specialized hook if it grows
    } = useSapStore();

    const [sortKey, setSortKey] = useState('SAPDispatchNumber');
    const [sortDir, setSortDir] = useState(1);
    const [filter, setFilter] = useState('all');

    const handleSort = (key) => {
        if (sortKey === key) {
            setSortDir(prev => prev * -1);
        } else {
            setSortKey(key);
            setSortDir(1);
        }
    };

    //  Derived stats
    const total = shipments.length;
    const delivered = Object.values(assignments).filter(a => a.tripStatus?.toLowerCase() === 'completed').length;
    const transit = shipments.filter(s => (s.PgiStatus || s.CheckStatus || "").toUpperCase() === 'IN TRANSIT').length;

    if (loading) {
        return <div className="flex items-center justify-center h-full text-db-text3 italic">Loading SAP shipments...</div>;
    }

    return (
        <div className="p-6 h-full flex flex-col">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-db-text font-display">SAP Shipments</h1>
                    <p className="text-xs text-db-text3 mt-1">Real-time synchronization with SAP OData</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={refreshShipments}
                        className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-db-panel border border-db-border text-db-text2 hover:bg-db-item-hover transition-all flex items-center gap-2 shadow-sm"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 7M1 17l.51-4.64a9 9 0 0114.85-3.36L23 17"/></svg>
                        Sync Now
                    </button>
                </div>
            </div>

            <SapStatsBar total={total} delivered={delivered} transit={transit} />

            <div className="flex items-center gap-2 mb-4">
                {['all', 'forAssignment', 'assigned', 'loading', 'fully_loaded', 'in_transit', 'delivered'].map(type => (
                    <button
                        key={type}
                        onClick={() => setFilter(type)}
                        className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all border ${
                            filter === type
                                ? 'bg-db-item-active text-db-text border-db-item-active'
                                : 'bg-db-panel/40 text-db-text3 border-transparent hover:border-db-border'
                        }`}
                    >
                        {type.replace(/([A-Z])/g, ' $1').replace('forAssignment', 'For Assignment')}
                    </button>
                ))}
            </div>

            <div className="flex-1 overflow-hidden">
                <SapShipmentTable
                    shipments={shipments}
                    assignments={assignments}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    onAssign={undefined}
                />
            </div>
        </div>
    );
};

export default SAPView;
