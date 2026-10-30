import React, { useState } from "react";
import { SecurityGuardService } from "../../api/securityGuardService";

/**
 * GuardSignatureModal Component
 * Interface for capturing and verifying security guard signatures.
 */
const GuardSignatureModal = ({ guardId, onSave, onClose }) => {
  const [isSigning, setIsSigning] = useState(false);
  const [signatureData, setSignatureData] = useState(null);

  const handleCapture = async () => {
    setIsSigning(true);
    //  Simulate signature capture logic
    setTimeout(async () => {
      const mockSignature = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...";
      setSignatureData(mockSignature);
      setIsSigning(false);
    }, 1500);
  };

  const handleSave = async () => {
    if (!signatureData) return;
    try {
      await SecurityGuardService.updateSignature(guardId, signatureData);
      onSave();
    } catch (e) {
      console.error("Save signature error:", e);
      alert("Failed to save signature.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-db-panel border border-db-border rounded-3xl shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-db-border flex items-center justify-between bg-db-panel/50">
          <div>
            <h3 className="text-lg font-bold text-db-text font-display">
              Capture Signature
            </h3>
            <p className="text-xs text-db-text3">Security Guard Verification</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-db-text3 hover:text-sysu-red transition-colors"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="p-8 flex flex-col items-center gap-6">
          <div className="w-full aspect-[4/3] bg-db-bg border-2 border-dashed border-db-border rounded-2xl flex items-center justify-center relative overflow-hidden">
            {signatureData ? (
              <img
                src={signatureData}
                alt="Guard Signature"
                className="w-full h-full object-contain p-4"
              />
            ) : (
              <div className="text-center p-6">
                <div className="w-12 h-12 rounded-full bg-sysu-red/10 text-sysu-red flex items-center justify-center mx-auto mb-3">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M12 19l7-7 3 3-7 7-3-3z" />
                    <path d="M18 12l-7 7-3-3" />
                  </svg>
                </div>
                <p className="text-sm font-bold text-db-text3">
                  No signature captured yet
                </p>
                <p className="text-[10px] text-db-text3/60 mt-1">
                  Click "Capture" to begin signing
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-3 w-full">
            <button
              onClick={handleCapture}
              disabled={isSigning}
              className="flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-wider bg-db-bg border border-db-border text-db-text hover:border-sysu-red transition-all disabled:opacity-50"
            >
              {isSigning ? "Capturing..." : "Capture Signature"}
            </button>
            <button
              onClick={handleSave}
              disabled={!signatureData}
              className="flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-wider bg-sysu-red hover:bg-sysu-red-dark text-white transition-all shadow-lg shadow-sysu-red/25 disabled:opacity-50"
            >
              Verify & Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GuardSignatureModal;
