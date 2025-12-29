import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface ResizablePanelsProps {
  leftPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  defaultLeftWidth?: number; // percentage 0-100
  minLeftWidth?: number; // percentage
  maxLeftWidth?: number; // percentage
  storageKey?: string;
  className?: string;
}

export function ResizablePanels({
  leftPanel,
  rightPanel,
  defaultLeftWidth = 40,
  minLeftWidth = 25,
  maxLeftWidth = 60,
  storageKey = 'resizable-panels-width',
  className,
}: ResizablePanelsProps) {
  const [leftWidth, setLeftWidth] = useState(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= minLeftWidth && parsed <= maxLeftWidth) {
          return parsed;
        }
      }
    }
    return defaultLeftWidth;
  });

  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const newLeftWidth = ((e.clientX - rect.left) / rect.width) * 100;

      const clampedWidth = Math.min(maxLeftWidth, Math.max(minLeftWidth, newLeftWidth));
      setLeftWidth(clampedWidth);
    },
    [isDragging, minLeftWidth, maxLeftWidth]
  );

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      if (storageKey) {
        localStorage.setItem(storageKey, leftWidth.toString());
      }
    }
  }, [isDragging, leftWidth, storageKey]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div
      ref={containerRef}
      className={cn('flex h-full', className)}
    >
      {/* Left Panel */}
      <div
        className="overflow-y-auto pr-4"
        style={{ width: `${leftWidth}%` }}
      >
        {leftPanel}
      </div>

      {/* Divider */}
      <div
        className={cn(
          'relative w-1 cursor-col-resize flex-shrink-0 group',
          isDragging && 'bg-primary/20'
        )}
        onMouseDown={handleMouseDown}
      >
        <div
          className={cn(
            'absolute inset-y-0 -left-1 -right-1 flex items-center justify-center',
            'hover:bg-primary/10 transition-colors'
          )}
        >
          <div
            className={cn(
              'w-1 h-12 rounded-full bg-border transition-colors',
              'group-hover:bg-primary/50',
              isDragging && 'bg-primary'
            )}
          />
        </div>
      </div>

      {/* Right Panel */}
      <div
        className="overflow-y-auto pl-4"
        style={{ width: `${100 - leftWidth}%` }}
      >
        {rightPanel}
      </div>
    </div>
  );
}

