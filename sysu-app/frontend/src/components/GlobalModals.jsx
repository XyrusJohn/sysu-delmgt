import React from "react";

/**
 * GlobalModals Component
 * Orchestrates the visibility of all dashboard modals.
 */
const GlobalModals = ({ modals, openModal, closeModal, closeAllModals }) => {
  return (
    <>
      {modals.profile && (
        <ProfileModal
          isOpen={modals.profile}
          onClose={() => closeModal("profile")}
        />
      )}
      {modals.assignDriver && (
        <AssignDriverModal
          isOpen={modals.assignDriver}
          onClose={() => closeModal("assignDriver")}
        />
      )}
      {modals.podPreview && (
        <PodPreviewModal
          isOpen={modals.podPreview}
          onClose={() => closeModal("podPreview")}
        />
      )}
      {modals.guardSignature && (
        <GuardSignatureModal
          isOpen={modals.guardSignature}
          onClose={() => closeModal("guardSignature")}
        />
      )}
      {modals.driver && (
        <DriverModal
          isOpen={modals.driver}
          onClose={() => closeModal("driver")}
        />
      )}
    </>
  );
};

//  Placeholder components to avoid import errors until implemented
const ProfileModal = ({ isOpen, onClose }) =>
  isOpen && (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-db-panel p-6 rounded-2xl border border-db-border w-96"
        onClick={(e) => e.stopPropagation()}
      >
        Profile Modal
      </div>
    </div>
  );
const AssignDriverModal = ({ isOpen, onClose }) =>
  isOpen && (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-db-panel p-6 rounded-2xl border border-db-border w-96"
        onClick={(e) => e.stopPropagation()}
      >
        Assign Driver Modal
      </div>
    </div>
  );
const PodPreviewModal = ({ isOpen, onClose }) =>
  isOpen && (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-db-panel p-6 rounded-2xl border border-db-border w-[80vw] h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        POD Preview Modal
      </div>
    </div>
  );
const GuardSignatureModal = ({ isOpen, onClose }) =>
  isOpen && (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-db-panel p-6 rounded-2xl border border-db-border w-96"
        onClick={(e) => e.stopPropagation()}
      >
        Guard Signature Modal
      </div>
    </div>
  );
const DriverModal = ({ isOpen, onClose }) =>
  isOpen && (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-db-panel p-6 rounded-2xl border border-db-border w-96"
        onClick={(e) => e.stopPropagation()}
      >
        Driver Modal
      </div>
    </div>
  );

export default GlobalModals;
