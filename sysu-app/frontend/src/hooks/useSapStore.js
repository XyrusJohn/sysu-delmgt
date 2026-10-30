import { useState, useEffect } from 'react';
import { SAPService, SAPAssignmentService } from '../api/sapService';

/**
 * useSapStore Hook
 * Orchestrates synchronization between external SAP shipments and SQL-backed assignments.
 *
 * Implements the "Everything Claude Code" standard for data separation.
 */
export const useSapStore = () => {
    const [shipments, setShipments] = useState([]);
    const [assignments, setAssignments] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    //  SAP Shipment Sync (External API)
    const fetchShipments = async () => {
        setLoading(true);
        try {
            const data = await SAPService.fetchShipments();
            setShipments(data);
            setError(null);
        } catch (err) {
            console.error("SAP Fetch Error:", err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    //  Assignment Sync (Socket.IO)
    useEffect(() => {
        const unsubscribe = SAPService.subscribeToAssignments((data) => {
            setAssignments(data);
        });

        fetchShipments();

        return () => unsubscribe();
    }, []);

    //  Derived State / Helpers

    /**
     * Returns assignments filtered and sorted.
     * Replaces the manual sorting logic previously inside the Dashboard class.
     */
    const getSortedAssignments = (sortKey = 'SAPDispatchNumber', sortDir = 1) => {
        return Object.entries(assignments)
            .map(([id, data]) => ({ id, ...data }))
            .sort((a, b) => {
                const valA = a[sortKey] || '';
                const valB = b[sortKey] || '';
                return valA < valB ? -sortDir : valA > valB ? sortDir : 0;
            });
    };

    /**
     * Maps a shipment to its current assignment details.
     */
    const getAssignmentForShipment = (dispatchKey) => {
        return assignments[dispatchKey] || null;
    };

    return {
        shipments,
        assignments,
        sortedAssignments: getSortedAssignments,
        getAssignmentForShipment,
        loading,
        error,
        refreshShipments: fetchShipments,
        assignDriver: SAPAssignmentService.assignDriver,
        peekEarliest: SAPAssignmentService.peekEarliest
    };
};
