import { useState, useEffect } from "react";
import { socket, EVENTS } from "../api/socket";
import { fetchWithTimeout } from "../api/fetchWithTimeout.js";

/**
 * useWarehouseGeofence Hook
 * Manages the warehouse base location, radius, and geofence updates.
 */
export const useWarehouseGeofence = () => {
  const [base, setBase] = useState({
    name: "SYSU Main Warehouse",
    address: "",
    lat: 14.6349,
    lng: 121.0392,
    radiusMeters: 500,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    const timeout = setTimeout(() => {
      if (active)
        setLoadError(
          "Warehouse settings did not respond. Confirm the displayed settings with your administrator before saving.",
        );
    }, 10_000);
    //  Sync initial state from socket
    socket.emit(EVENTS.GET_WAREHOUSE_BASE, (res) => {
      clearTimeout(timeout);
      if (!active) return;
      if (res && res.success && res.data) {
        setBase(res.data);
        setLoadError("");
      } else {
        setLoadError(
          res?.message || "Could not load the saved warehouse settings.",
        );
      }
    });

    //  Listen for real-time updates from other admins
    const handleUpdate = (data) => {
      setBase(data);
      setLoadError("");
    };

    socket.on(EVENTS.WAREHOUSE_BASE_UPDATED, handleUpdate);
    return () => {
      active = false;
      clearTimeout(timeout);
      socket.off(EVENTS.WAREHOUSE_BASE_UPDATED, handleUpdate);
    };
  }, []);

  const updateBase = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError("");
    setSaveSuccess(false);
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      setSaving(false);
      setSaveError(
        "No server confirmation yet. Check the saved warehouse settings before trying again.",
      );
    }, 10_000);
    socket.emit(EVENTS.SAVE_WAREHOUSE_BASE, base, (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      setSaving(false);
      if (!res || !res.success) {
        setSaveError(res?.message || "Failed to save warehouse base.");
        return;
      }
      setSaveSuccess(true);
    });
  };

  const searchLocation = async (query) => {
    setLoading(true);
    setSearchError("");
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=ph&limit=1`;
      const res = await fetchWithTimeout(url, {}, 12_000);
      if (!res.ok)
        throw new Error(`Search service returned HTTP ${res.status}.`);
      const data = await res.json();

      if (data && data.length > 0) {
        const loc = data[0];
        setBase((prev) => ({
          ...prev,
          lat: parseFloat(loc.lat),
          lng: parseFloat(loc.lon),
          address: loc.display_name,
        }));
      } else {
        setSearchError(
          "No matching location found. Try a nearby landmark or city.",
        );
      }
    } catch (e) {
      console.error("Search error:", e);
      setSearchError(
        e?.code === "REQUEST_TIMEOUT"
          ? "Location search took too long. Check the connection and try again."
          : "Could not search for that location. Check the connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return {
    base,
    setBase,
    updateBase,
    searchLocation,
    loading,
    saving,
    loadError,
    searchError,
    saveError,
    saveSuccess,
  };
};
