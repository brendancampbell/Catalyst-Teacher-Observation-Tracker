import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const NAVY = "#1034B4";

/**
 * Paging state, clamped.
 *
 * The clamp is the reason this is a hook rather than a `useState` at each call
 * site: a row set can shrink between renders — a filter narrows, a refetch
 * returns fewer rows, an observation is deleted — and a stored page index then
 * points past the end, leaving a table that is not empty showing nothing at
 * all. Deriving the page from the row count instead of trusting the stored
 * number makes that unrepresentable.
 */
export function usePagination<T>(rows: T[], initialPageSize = 25) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const pageStart  = (safePage - 1) * pageSize;
  const paged      = useMemo(
    () => rows.slice(pageStart, pageStart + pageSize),
    [rows, pageStart, pageSize],
  );

  return { page: safePage, setPage, pageSize, setPageSize, totalPages, pageStart, paged };
}

export interface TablePaginationProps {
  total:      number;
  page:       number;
  pageSize:   number;
  pageStart:  number;
  totalPages: number;
  onPage:     (n: number) => void;
  onPageSize: (n: number) => void;
  /** Singular and plural of what is being counted, e.g. ["person", "people"]. */
  noun:       [string, string];
  pageSizes?: number[];
}

/**
 * The pagination footer used under every long table in the tool.
 *
 * Extracted from the Usage table so a second table does not mean a second set
 * of page controls that drift apart — the labels here are what the tests and
 * anyone using a screen reader navigate by, and two tables disagreeing about
 * whether the button is "Next page" or "Next" is the kind of difference nobody
 * notices until it matters.
 */
export function TablePagination({
  total, page, pageSize, pageStart, totalPages, onPage, onPageSize, noun,
  pageSizes = [10, 25, 50, 100],
}: TablePaginationProps) {
  const btn = "w-7 h-7 flex items-center justify-center rounded border text-xs font-semibold transition-colors disabled:opacity-30";
  const btnStyle = { borderColor: "#dde3f0", color: NAVY };

  return (
    <div className="grid items-center pt-1 pb-2" style={{ gridTemplateColumns: "1fr auto 1fr" }}>
      <p className="text-xs text-slate-400">
        {total === 0
          ? `No ${noun[1]} to show`
          : `Showing ${pageStart + 1}–${Math.min(pageStart + pageSize, total)} of ${total} ${total === 1 ? noun[0] : noun[1]}`}
      </p>

      {/* Page buttons — center */}
      <div className="flex items-center gap-1">
        <button
          className={btn} style={btnStyle}
          disabled={page === 1}
          onClick={() => onPage(1)}
          title="First page" aria-label="First page"
        ><ChevronLeft size={12} /><ChevronLeft size={12} /></button>
        <button
          className={btn} style={btnStyle}
          disabled={page === 1}
          onClick={() => onPage(Math.max(1, page - 1))}
          title="Previous page" aria-label="Previous page"
        ><ChevronLeft size={14} /></button>

        {/* Page number pills — first, last, and the neighbours of the current
            page; the gaps collapse to an ellipsis. */}
        {Array.from({ length: totalPages }, (_, i) => i + 1)
          .filter((n) => n === 1 || n === totalPages || Math.abs(n - page) <= 1)
          .reduce<(number | "…")[]>((acc, n, idx, arr) => {
            if (idx > 0 && n - (arr[idx - 1] as number) > 1) acc.push("…");
            acc.push(n);
            return acc;
          }, [])
          .map((n, i) =>
            n === "…"
              ? <span key={`ellipsis-${i}`} className="w-7 h-7 flex items-center justify-center text-xs text-slate-400">…</span>
              : <button
                  key={n}
                  className="w-7 h-7 flex items-center justify-center rounded text-xs font-bold transition-colors"
                  style={n === page
                    ? { backgroundColor: NAVY, color: "white" }
                    : { border: "1px solid #dde3f0", color: NAVY }}
                  onClick={() => onPage(n as number)}
                  aria-label={`Page ${n}`}
                  aria-current={n === page ? "page" : undefined}
                >{n}</button>
          )}

        <button
          className={btn} style={btnStyle}
          disabled={page === totalPages}
          onClick={() => onPage(Math.min(totalPages, page + 1))}
          title="Next page" aria-label="Next page"
        ><ChevronRight size={14} /></button>
        <button
          className={btn} style={btnStyle}
          disabled={page === totalPages}
          onClick={() => onPage(totalPages)}
          title="Last page" aria-label="Last page"
        ><ChevronRight size={12} /><ChevronRight size={12} /></button>
      </div>

      {/* Per-page picker — right */}
      <label className="flex items-center justify-end gap-1.5 text-xs text-slate-500">
        Per page
        <select
          className="border border-slate-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
          value={pageSize}
          onChange={(e) => { onPageSize(Number(e.target.value)); onPage(1); }}
          aria-label="Rows per page"
        >
          {pageSizes.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </div>
  );
}
