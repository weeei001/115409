import React, { useRef } from 'react';
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

interface VirtualDataTableProps<TData extends object> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  height?: number;
  rowHeight?: number;
  emptyText?: string;
  getRowId?: (row: TData, index: number) => string;
}

export function VirtualDataTable<TData extends object>({
  columns,
  data,
  height = 260,
  rowHeight = 44,
  emptyText = '目前沒有資料',
  getRowId,
}: VirtualDataTableProps<TData>) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const table = useReactTable<TData>({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: getRowId ? (row, index) => getRowId(row, index) : undefined,
  });

  const rows = table.getRowModel().rows;
  const leafColumns = table.getAllLeafColumns();
  const gridTemplateColumns = leafColumns
    .map((column) => `${Math.max(column.getSize(), 88)}px`)
    .join(' ');
  const minWidth = leafColumns.reduce((sum, column) => sum + Math.max(column.getSize(), 88), 0);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
      <div
        className="grid border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]"
        style={{ gridTemplateColumns, minWidth }}
      >
        {table.getHeaderGroups().map((headerGroup) =>
          headerGroup.headers.map((header) => (
            <div
              key={header.id}
              className="px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)]"
            >
              {header.isPlaceholder
                ? null
                : flexRender(header.column.columnDef.header, header.getContext())}
            </div>
          ))
        )}
      </div>

      {rows.length === 0 ? (
        <div className="px-3 py-6 text-center text-sm text-[var(--color-text-muted)]">{emptyText}</div>
      ) : (
        <div ref={scrollRef} className="overflow-auto" style={{ height }}>
          <div style={{ height: rowVirtualizer.getTotalSize(), minWidth, position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((virtualItem) => {
              const row = rows[virtualItem.index];
              return (
                <div
                  key={row.id}
                  className="grid border-b border-[var(--color-border)]"
                  style={{
                    gridTemplateColumns,
                    transform: `translateY(${virtualItem.start}px)`,
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <div key={cell.id} className="px-3 py-2 text-xs text-[var(--color-text-primary)]">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

