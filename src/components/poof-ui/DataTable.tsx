import type { ReactNode } from 'react';

interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  /** Optional caption shown below the table */
  caption?: string;
  className?: string;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  caption,
  className = '',
}: DataTableProps<T>) {
  return (
    <div className={`overflow-hidden rounded-lg border border-border/60 bg-card/40 backdrop-blur-sm shadow-sm ${className}`}>
      <div className='overflow-x-auto'>
        <table className='w-full text-sm'>
          <thead>
            <tr className='border-b border-border/60 bg-muted/40'>
              {columns.map(col => (
                <th
                  key={col.key}
                  className='px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground'
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className='divide-y divide-border/30'>
            {data.map((row, i) => (
              <tr
                key={i}
                className='transition-colors duration-150 hover:bg-primary/5 even:bg-muted/10'
              >
                {columns.map(col => (
                  <td key={col.key} className='px-4 py-3 text-foreground'>
                    {col.render ? col.render(row) : String(((row as Record<string, unknown>)[col.key] ?? '') as string | number)}
                  </td>
                ))}
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className='px-4 py-12 text-center text-muted-foreground'
                >
                  No data
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {caption && (
        <div className='border-t border-border/30 px-4 py-2'>
          <p className='text-xs text-muted-foreground/70'>{caption}</p>
        </div>
      )}
    </div>
  );
}
