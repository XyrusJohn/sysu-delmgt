import { useState } from 'react';
import { useImageZoomPan } from '../../hooks/useImageZoomPan';

/**
 * PodPreviewModal Component
 * High-performance POD image viewer with spring-based zoom and pan.
 */
const PodPreviewModal = ({ imageSrc, onClose }) => {
    const {
        transform,
        setTransform,
        zoom,
        setZoom,
        isDragging,
        handleMouseDown,
        handleMouseMove,
        handleMouseUp,
        handleWheel
    } = useImageZoomPan();

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md animate-in fade-in duration-200">
            {/* Close Button */}
            <button
                onClick={onClose}
                className="absolute top-6 right-6 z-50 p-3 rounded-full bg-db-panel border border-db-border text-db-text hover:bg-sysu-red hover:text-white transition-all shadow-2xl"
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>

            {/* Zoom Indicator */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-db-panel/80 border border-db-border text-db-text text-xs font-mono font-bold backdrop-blur-sm shadow-xl">
                Zoom: {Math.round(zoom * 100)}%
            </div>

            {/* Image Container */}
            <div
                className={`relative w-full h-full overflow-hidden cursor-grab ${isDragging ? 'cursor-grabbing' : ''}`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onWheel={handleWheel}
            >
                <img
                    src={imageSrc}
                    alt="POD Proof of Delivery"
                    className="absolute transition-transform duration-75 ease-out"
                    style={{
                        transform: `translate(${transform.x}px, ${transform.y}px) scale(${zoom})`,
                        transformOrigin: 'center',
                        maxHeight: '90vh',
                        maxWidth: '90vw',
                        left: '50%',
                        top: '50%',
                        marginLeft: '-50%', // Simplified centering for example
                        marginTop: '-50%',
                        //  Note: Use an actual centering logic in useImageZoomPan for production
                    }}
                />
            </div>
        </div>
    );
};

export default PodPreviewModal;
