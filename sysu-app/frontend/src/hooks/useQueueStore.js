import { useState, useEffect } from 'react';
import { subscribeRealtime, asCollectionSnapshot } from '../api/realtimeService';

/**
 * useQueueStore Hook
 * Decouples the real-time queue logic from the Dashboard UI.
 * Implements the "Many Small Files" rule from everything-claude-code.
 */
export const useQueueStore = () => {
    const [queue, setQueue] = useState([]);
    const [counts, setCounts] = useState({ AUV: 0, '4W': 0, '6W': 0, '10W': 0, '20F': 0, '40F': 0 });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = subscribeRealtime('queue', {order: 'desc', limit: 100}, (rows) => {
            const drivers = asCollectionSnapshot(rows).docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            const newCounts = { AUV: 0, '4W': 0, '6W': 0, '10W': 0, '20F': 0, '40F': 0 };
            drivers.forEach(d => {
                const type = (d.truckType || '').toUpperCase();
                if (type.includes('AUV')) newCounts.AUV++;
                else if (type.includes('4W')) newCounts['4W']++;
                else if (type.includes('6W')) newCounts['6W']++;
                else if (type.includes('10W')) newCounts['10W']++;
                else if (type.includes('20F')) newCounts['20F']++;
                else if (type.includes('40F')) newCounts['40F']++;
            });

            setQueue(drivers);
            setCounts(newCounts);
            setLoading(false);
        }, (err) => {
            console.error("Queue sync error:", err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    return {
        queue,
        counts,
        loading
    };
};
