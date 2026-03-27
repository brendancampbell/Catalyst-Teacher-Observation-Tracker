import { useState, useRef, useEffect } from "react";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

export function FilterMultiSelect({ label, values, onChange, options }: {
  label:    string;
  values:   string[];
  onChange: (v: string[]) => void;
  options:  string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = values.length > 0;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded font-semibold text-sm transition-colors"
        style={{
          border: `1.5px solid ${active ? NAVY : "#dde3f0"}`,
          backgroundColor: active ? NAVY : "white",
          color: active ? "white" : "#334155",
          fontFamily: "'Libre Franklin', sans-serif",
        }}
      >
        {label}
        {active && (
          <span
            className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold"
            style={{ backgroundColor: YELLOW, color: NAVY }}
          >
            {values.length}
          </span>
        )}
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 bg-white rounded-md shadow-lg z-50 py-1 min-w-[160px]"
          style={{ border: "1px solid #dde3f0" }}
        >
          {options.map((opt) => {
            const checked = values.includes(opt);
            return (
              <label
                key={opt}
                className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-slate-50 text-sm font-medium text-slate-700"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onChange(checked ? values.filter((v) => v !== opt) : [...values, opt])}
                  className="w-4 h-4 rounded accent-blue-700"
                />
                {opt}
              </label>
            );
          })}
          {values.length > 0 && (
            <div className="border-t border-slate-100 mt-1 pt-1 px-3 pb-1">
              <button
                className="text-xs font-semibold underline underline-offset-1"
                style={{ color: NAVY }}
                onClick={(e) => { e.stopPropagation(); onChange([]); }}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
