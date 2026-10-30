import React, { useState } from "react";
import PropTypes from "prop-types";

const PodPreview = ({ imageUrl, capturedAt }) => {
  const [showModal, setShowModal] = useState(false);

  const handleOpenModal = () => setShowModal(true);
  const handleCloseModal = () => setShowModal(false);

  const formattedDate = new Date(capturedAt).toLocaleString();

  return (
    <div>
      <button
        onClick={handleOpenModal}
        className="p-1 bg-db-panel/30 border border-db-border rounded hover:bg-db-item-hover/50 transition-colors"
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="POD thumbnail"
            className="h-10 w-auto object-contain"
          />
        ) : (
          <span className="text-xs text-db-text3">No Image</span>
        )}
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-db-panel border border-db-border rounded-lg p-6 relative w-96">
            <button
              onClick={handleCloseModal}
              className="absolute top-2 right-2 text-db-text3 hover:text-db-text"
            >
              ✕
            </button>
            <div className="space-y-4">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt="POD"
                  className="rounded max-w-full h-auto"
                />
              ) : (
                <p className="text-center text-db-text3">No image available</p>
              )}
              <p className="text-xs text-db-text3">
                Captured at:{" "}
                <span className="font-medium">{formattedDate}</span>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

PodPreview.propTypes = {
  imageUrl: PropTypes.string,
  capturedAt: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.instanceOf(Date),
  ]).isRequired,
};

PodPreview.defaultProps = {
  imageUrl: "",
};

export default PodPreview;
