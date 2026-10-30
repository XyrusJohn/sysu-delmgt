import { useState, useCallback } from "react";

/**
 * useImageZoomPan Hook
 * Handles high-performance zoom and pan logic for large images (PODs).
 * Uses a simple offset system that can be extended with spring animations.
 */
export const useImageZoomPan = () => {
  const [zoom, setZoom] = useState(1);
  const [transform, setTransform] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e) => {
    setIsDragging(true);
    setLastMousePos({ x: e.clientX, y: e.clientY });
  }, []);

  const handleMouseMove = useCallback(
    (e) => {
      if (!isDragging) return;

      const dx = e.clientX - lastMousePos.x;
      const dy = e.clientY - lastMousePos.y;

      setTransform((prev) => ({
        x: prev.x + dx,
        y: prev.y + dy,
      }));

      setLastMousePos({ x: e.clientX, y: e.clientY });
    },
    [isDragging, lastMousePos],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const zoomSpeed = 0.1;
    const delta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
    setZoom((prev) => Math.min(Math.max(prev + delta, 0.5), 5));
  }, []);

  return {
    zoom,
    setZoom,
    transform,
    setTransform,
    isDragging,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
  };
};
