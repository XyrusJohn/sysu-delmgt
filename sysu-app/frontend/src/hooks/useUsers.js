import { useState, useEffect } from 'react';
import { subscribeRealtime, asCollectionSnapshot } from '../api/realtimeService';

/**
 * useUsers Hook
 * Manages the administrative user list, role updates, and deletions.
 */
export const useUsers = () => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const unsubscribe = subscribeRealtime('users', {}, (rows) => {
                const userList = asCollectionSnapshot(rows).docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                setUsers(userList);
                setLoading(false);
            }, (err) => {
                console.error("Users sync error:", err);
                setError(err.message);
                setLoading(false);
            });

        return () => unsubscribe();
    }, []);

    return {
        users,
        loading,
        error,
    };
};
