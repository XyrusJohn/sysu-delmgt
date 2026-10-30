import React, { useState, useEffect } from 'react';
import { useWarehouseGeofence } from '../../hooks/useWarehouseGeofence';
import L from 'leaflet';
import { addMinimalMapTiles } from '../MapManager.js';

/**
 * WarehouseBaseEditor Component
 * Interactive map-based editor for the warehouse location and geofence radius.
 */
const WarehouseBaseEditor = () => {
    const {
        base,
        setBase,
        updateBase,
        searchLocation,
        loading: searchLoading,
        saving,
        loadError,
        searchError,
        saveError,
        saveSuccess,
    } = useWarehouseGeofence();

    const [map, setMap] = useState(null);
    const [marker, setMarker] = useState(null);
    const [circle, setCircle] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        if (!map) {
            const mapInstance = L.map('warehouseBaseMap', {
                center: [base.lat, base.lng],
                zoom: 15,
                maxZoom: 19,
                zoomControl: true,
                attributionControl: true,
            }).addTo(window); // Simplified for example
            mapInstance.attributionControl?.setPrefix(false);
            addMinimalMapTiles(mapInstance, 'warehouseBaseMap');

            const m = L.marker([base.lat, base.lng], { draggable: true }).addTo(mapInstance);
            const c = L.circle([base.lat, base.lng], {
                radius: base.radiusMeters,
                color: '#DC2626',
                fillColor: '#DC2626',
                fillOpacity: 0.15,
            }).addTo(mapInstance);

            m.on('drag', (e) => {
                const pos = e.target.getLatLng();
                setBase(prev => ({ ...prev, lat: pos.lat, lng: pos.lng }));
                c.setLatLng(pos);
            });

            mapInstance.on('click', (e) => {
                const pos = e.latlng;
                m.setLatLng(pos);
                c.setLatLng(pos);
                setBase(prev => ({ ...prev, lat: pos.lat, lng: pos.lng }));
            });

            setMap(mapInstance);
            setMarker(m);
            setCircle(c);
        }
    }, [base]);

    const handleSearch = async () => {
        if (searchQuery.length < 2) return;
        await searchLocation(searchQuery);
    };

    return (
        <div className="flex flex-col lg:flex-row gap-6 h-full">
            {/* Map Section */}
            <div className="flex-1 bg-db-panel p-4 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                        <span className="text-xs font-bold text-db-text uppercase tracking-wider">Interactive Map Picker</span>
                    </div>
                    <span className="text-[11px] text-db-text3 italic">Click to set warehouse position</span>
                </div>

                <div className="relative mb-3">
                    <input
                        type="text"
                        placeholder="Search address or landmark..."
                        className="w-full h-11 bg-db-bg border border-db-border rounded-xl pl-10 pr-4 text-sm text-db-text outline-none focus:border-sysu-red transition-all"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSearch()}
                    />
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-db-text3">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    </div>
                </div>
                {searchLoading && <p role="status" className="mb-2 text-xs text-db-text3">Searching locations…</p>}
                {searchError && <p role="alert" className="mb-2 text-xs text-sysu-red">{searchError}</p>}
                {loadError && <p role="alert" className="mb-2 text-xs text-sysu-red">{loadError}</p>}

                <div id="warehouseBaseMap" className="flex-1 overflow-hidden bg-slate-900 min-h-[400px]" />

                <div className="mt-3 flex items-center justify-between text-[11px] text-db-text3 px-1">
                    <span className="font-mono text-db-text2">Coords: {base.lat.toFixed(6)}, {base.lng.toFixed(6)}</span>
                    <span className="font-mono text-sysu-gold">Radius: {base.radiusMeters}m</span>
                </div>
            </div>

            {/* Settings Section */}
            <div className="w-full lg:w-80 flex flex-col gap-4">
                <div className="bg-db-panel border border-db-border rounded-2xl p-5 shadow-xl space-y-4">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-db-text uppercase tracking-wider">Geofence Radius</label>
                        <span className="px-2 py-1 rounded-lg text-xs font-mono font-bold bg-sysu-gold/15 text-sysu-gold border border-sysu-gold/30">
                            {base.radiusMeters}m
                        </span>
                    </div>

                    <input
                        type="range"
                        min="50"
                        max="5000"
                        step="25"
                        value={base.radiusMeters}
                        onChange={e => setBase(prev => ({ ...prev, radiusMeters: parseInt(e.target.value) }))}
                        className="w-full h-2 bg-db-bg rounded-lg appearance-none cursor-pointer accent-sysu-red"
                    />

                    <div className="flex justify-between text-[10px] text-db-text3 font-mono">
                        <span>50m</span>
                        <span>500m</span>
                        <span>1km</span>
                        <span>5km</span>
                    </div>
                </div>

                <div className="bg-db-panel border border-db-border rounded-2xl p-5 shadow-xl space-y-3">
                    <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-db-text3 mb-1">Warehouse Name</label>
                        <input
                            type="text"
                            value={base.name}
                            onChange={e => setBase(prev => ({ ...prev, name: e.target.value }))}
                            className="w-full h-10 bg-db-bg border border-db-border rounded-xl px-3 text-sm text-db-text focus:border-sysu-red outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-db-text3 mb-1">Address</label>
                        <input
                            type="text"
                            value={base.address}
                            onChange={e => setBase(prev => ({ ...prev, address: e.target.value }))}
                            className="w-full h-10 bg-db-bg border border-db-border rounded-xl px-3 text-sm text-db-text focus:border-sysu-red outline-none"
                        />
                    </div>
                    <button
                        onClick={updateBase}
                        disabled={saving}
                        className="w-full py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-sysu-red hover:bg-sysu-red-dark text-white transition-all shadow-lg shadow-sysu-red/25"
                    >
                        {saving ? 'Saving…' : 'Save Configuration'}
                    </button>
                    {saveError && <p role="alert" className="text-xs text-sysu-red">{saveError}</p>}
                    {saveSuccess && <p role="status" className="text-xs text-emerald-600">Warehouse settings saved.</p>}
                </div>
            </div>
        </div>
    );
};

export default WarehouseBaseEditor;
