import { useState, useEffect } from 'react';
import { subscribeRealtime, asCollectionSnapshot } from '../api/realtimeService';

/**
 * useFleetQueue Hook
 * Logic for the Fleet Manager view:
 * - Subscribes to the real-time queue.
 * - Groups drivers by truck type.
 * - Handles FIFO sorting and rank calculation.
 */
export const useFleetQueue = () => {
    const [queue, setQueue] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = subscribeRealtime('queue', {order: 'asc', limit: 100}, (rows) => {
            const drivers = asCollectionSnapshot(rows).docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(d => d.registrationComplete !== false && d.status !== 'completed');

            setQueue(drivers);
            setLoading(false);
        }, (err) => {
            console.error("Fleet queue sync error:", err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const getGroupedQueue = () => {
        const FLEET_TYPES = ['AUV', '4W', '6W', '10W', '20F', '40F', 'Reefer'];
        const grouped = {};

        FLEET_TYPES.forEach(type => {
            grouped[type] = queue.filter(d =>
                (d.truckType || "").toUpperCase().includes(type)
            );
        });

        //  Handle "Others"
        const others = queue.filter(d => {
            const type = (d.truckType || "").toUpperCase();
            return !FLEET_TYPES.some(ft => type.includes(ft));
        });
        grouped['Unknown'] = others;

        return grouped;
    };

    return {
        queue,
        groupedQueue: getGroupedQueue(),
        loading,
    };
};
