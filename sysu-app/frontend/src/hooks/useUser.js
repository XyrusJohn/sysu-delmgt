import { useState, useEffect } from 'react';
import { AuthService } from '../api/authService';

/**
 * useUser Hook
 * Centralizes user profile state and real-time synchronization.
 * Replaces manual profile tracking in the Dashboard fat class.
 */
export const useUser = () => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const unsubscribe = AuthService.subscribe((profile, err) => {
            if (err) {
                setError(err);
                setLoading(false);
            } else {
                setUser(profile);
                setLoading(false);
            }
        });

        return () => unsubscribe();
    }, []);

    const logout = async () => {
        try {
            await AuthService.logout();
        } catch (err) {
            console.error("Logout failed:", err);
            throw err;
        }
    };

    return {
        user,
        loading,
        error,
        logout,
        isAuthenticated: !!user,
        isAdmin: user?.role === 'admin' || user?.role === 'super_admin',
        isSuperAdmin: user?.role === 'super_admin'
    };
};
