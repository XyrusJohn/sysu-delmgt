import React, { useState, useEffect } from 'react';
import { useUser } from '../hooks/useUser';
import { useQueueStore } from '../hooks/useQueueStore';
import { useSapStore } from '../hooks/useSapStore';
import { useUsers } from '../hooks/useUsers';

import MapView from '../components/views/MapView';
import FleetManagerView from '../components/views/FleetManagerView';
import SAPView from '../components/views/SAPView';
import AdminPortalView from '../components/views/AdminPortalView';
import DocumentsView from '../components/views/DocumentsView';
import TrackingView from '../components/views/TrackingView';

import ProfileModal from '../components/modals/ProfileModal';
import AssignDriverModal from '../components/modals/AssignDriverModal';
import PodPreviewModal from '../components/modals/PodPreviewModal';
import GuardSignatureModal from '../components/modals/GuardSignatureModal';
import DriverModal from '../components/modals/DriverModal';

/**
 * Dashboard Component
 * The central operational hub of the sysu-app.
 */
const Dashboard = () => {
    const { user } = useUser();
    const { queue, loading: queueLoading } = useQueueStore();
    const { shipments, loading: sapLoading } = useSapStore();
    const { users } = useUsers();

    const [activeView, setActiveView] = useState('map');
    const [activeModal, setActiveModal] = useState(null);
    const [modalProps, setModalProps] = useState({});

    //  Modal Dispatcher
    const openModal = (modalId, props = {}) => {
        setActiveModal(modalId);
        setModalProps(props);
    };

    const closeModal = () => {
        setActiveModal(null);
        setModalProps({});
    };

    const renderView = () => {
        switch (activeView) {
            case 'map': return <MapView />;
            case 'fleet': return <FleetManagerView />;
            case 'sap': return <SAPView />;
            case 'admin': return <AdminPortalView />;
            case 'docs': return <DocumentsView />;
            case 'tracking': return <TrackingView />;
            default: return <MapView />;
        }
    };

    return (
        <div className="flex h-screen w-full bg-db-bg text-db-text overflow-hidden font-sans">
            {/* Sidebar Navigation */}
            <aside className="w-64 bg-db-panel border-r border-db-border flex flex-col shadow-2xl z-20">
                <div className="p-6 flex items-center gap-3 border-b border-db-border">
                    <div className="w-10 h-10 rounded-xl bg-sysu-red flex items-center justify-center text-white font-black text-xl shadow-lg shadow-sysu-red/30">S</div>
                    <div>
                        <h1 className="text-sm font-black uppercase tracking-tighter">SYSU Logistics</h1>
                        <span className="text-[10px] text-db-text3 font-mono">System v4.0.1</span>
                    </div>
                </div>

                <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
                    {[
                        { id: 'map', label: 'Overview Map', icon: 'map' },
                        { id: 'fleet', label: 'Fleet Manager', icon: 'truck' },
                        { id: 'sap', label: 'SAP Shipments', icon: 'file-text' },
                        { id: 'tracking', label: 'Real-time Tracking', icon: 'navigation' },
                        { id: 'admin', label: 'Admin Portal', icon: 'settings' },
                        { id: 'docs', label: 'System Docs', icon: 'book' },
                    ].map(item => (
                        <button
                            key={item.id}
                            onClick={() => setActiveView(item.id)}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                                activeView === item.id
                                ? 'bg-sysu-red text-white shadow-lg shadow-sysu-red/20'
                                : 'text-db-text3 hover:bg-db-item-hover hover:text-db-text'
                            }`}
                        >
                            <span className="opacity-70">{item.icon}</span>
                            {item.label}
                        </button>
                    ))}
                </nav>

                <div className="p-4 border-t border-db-border">
                    <button
                        onClick={() => openModal('profile')}
                        className="w-full flex items-center gap-3 p-3 rounded-xl bg-db-bg border border-db-border hover:border-sysu-red transition-all group"
                    >
                        <div className="w-8 h-8 rounded-full bg-db-panel border border-db-border flex items-center justify-center text-xs font-bold group-hover:border-sysu-red">
                            {user?.displayName?.[0] || 'U'}
                        </div>
                        <div className="flex flex-col items-start overflow-hidden">
                            <span className="text-xs font-bold truncate w-full">{user?.displayName || 'User'}</span>
                            <span className="text-[9px] text-db-text3 uppercase font-mono">{user?.role || 'viewer'}</span>
                        </div>
                    </button>
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 relative overflow-hidden flex flex-col">
                <header className="h-16 bg-db-panel border-b border-db-border px-6 flex items-center justify-between z-10">
                    <div className="flex items-center gap-4">
                        <span className="text-xs font-bold uppercase tracking-widest text-db-text3">
                            Current View: <span className="text-sysu-red">{activeView}</span>
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-db-bg border border-db-border">
                            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="text-[10px] font-mono text-db-text3">System Online</span>
                        </div>
                    </div>
                </header>

                <div className="flex-1 overflow-auto relative">
                    {renderView()}
                </div>
            </main>

            {/* Global Modal Layer */}
            {activeModal && (
                <>
                    {activeModal === 'profile' && <ProfileModal onClose={closeModal} user={user} />}
                    {activeModal === 'assignDriver' && <AssignDriverModal onClose={closeModal} {...modalProps} />}
                    {activeModal === 'podPreview' && <PodPreviewModal onClose={closeModal} imageSrc={modalProps.imageSrc} />}
                    {activeModal === 'guardSignature' && <GuardSignatureModal onClose={closeModal} guardId={modalProps.guardId} onSave={closeModal} />}
                    {activeModal === 'driver' && <DriverModal onClose={closeModal} driverId={modalProps.driverId} />}
                </>
            )}
        </div>
    );
};

export default Dashboard;
