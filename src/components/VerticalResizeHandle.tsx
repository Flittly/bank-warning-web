import { useCallback, useEffect, useRef } from 'react';

interface VerticalResizeHandleProps {
  onResize: (delta: number) => void;
}

function VerticalResizeHandle({ onResize }: VerticalResizeHandleProps) {
  const handleRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastY = useRef(0);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = lastY.current - e.clientY;
      lastY.current = e.clientY;
      onResizeRef.current(delta);
    };
    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastY.current = e.clientY;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  return (
    <div
      ref={handleRef}
      onMouseDown={onMouseDown}
      style={{
        height: 6,
        minHeight: 6,
        width: '100%',
        cursor: 'row-resize',
        background: 'transparent',
        transition: 'background 0.2s',
        zIndex: 20,
      }}
      onMouseEnter={(e) => {
        if (!dragging.current) {
          (e.target as HTMLElement).style.background = '#cbd5e1';
        }
      }}
      onMouseLeave={(e) => {
        if (!dragging.current) {
          (e.target as HTMLElement).style.background = 'transparent';
        }
      }}
    />
  );
}

export default VerticalResizeHandle;
