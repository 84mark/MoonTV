'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';

/** Fixed-height rows keep DOM size bounded even for the full IPTV directory. */
export default function VirtualChannelList<T extends { id: string }>({
  items,
  renderItem,
  resetKey,
}: {
  items: T[];
  renderItem: (item: T) => ReactNode;
  resetKey: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [height, setHeight] = useState(420);
  const rowHeight = 64;
  const overscan = 4;
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setHeight(element.clientHeight || 420);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (viewport.current) viewport.current.scrollTop = 0;
    setOffset(0);
  }, [resetKey]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const maxOffset = Math.max(0, items.length * rowHeight - height);
    if (element.scrollTop > maxOffset) {
      element.scrollTop = maxOffset;
      setOffset(maxOffset);
    }
  }, [items.length, height]);
  const firstVisible = Math.min(
    Math.floor(offset / rowHeight),
    Math.max(0, items.length - 1)
  );
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(
    items.length,
    start + Math.ceil(height / rowHeight) + 2 * overscan
  );
  return (
    <div
      ref={viewport}
      aria-label='滚动频道列表'
      tabIndex={0}
      className='relative min-h-[240px] flex-1 overflow-y-auto overscroll-contain'
      style={{ height: 'min(54vh, 520px)' }}
      onScroll={(event) => setOffset(event.currentTarget.scrollTop)}
    >
      <div
        role='list'
        aria-label='可选频道'
        style={{ height: items.length * rowHeight, position: 'relative' }}
      >
        {items.slice(start, end).map((item, index) => (
          <div
            role='listitem'
            aria-setsize={items.length}
            aria-posinset={start + index + 1}
            key={item.id}
            style={{
              position: 'absolute',
              top: (start + index) * rowHeight,
              height: rowHeight,
              left: 0,
              right: 0,
            }}
          >
            {renderItem(item)}
          </div>
        ))}
      </div>
    </div>
  );
}
