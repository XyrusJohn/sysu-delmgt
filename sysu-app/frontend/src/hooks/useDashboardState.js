import { useState } from "react";

/**
 * useDashboardState Hook
 * Manages the top-level UI state for the Dashboard, including
 * the active view and the visibility of global modals.
 */
export const useDashboardState = () => {
  const [activeView, setActiveView] = useState("overview");
  const [modals, setModals] = useState({
    profile: false,
    assignDriver: false,
    podPreview: false,
    guardSignature: false,
    driver: false,
  });

  const openModal = (modalName) => {
    setModals((prev) => ({ ...prev, [modalName]: true }));
  };

  const closeModal = (modalName) => {
    setModals((prev) => ({ ...prev, [modalName]: false }));
  };

  const closeAllModals = () => {
    setModals({
      profile: false,
      assignDriver: false,
      podPreview: false,
      guardSignature: false,
      driver: false,
    });
  };

  return {
    activeView,
    setActiveView,
    modals,
    openModal,
    closeModal,
    closeAllModals,
  };
};
