import { Link } from "wouter";
import { ClipboardList } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-md mx-4">
        {/* Playful icon above card */}
        <div className="flex justify-center mb-5">
          <div className="relative flex items-center justify-center">
            <ClipboardList className="w-16 h-16 text-slate-300" strokeWidth={1.25} />
            {/* Question mark overlay */}
            <span
              className="absolute font-display text-2xl leading-none"
              style={{ color: "#1034B4", top: "28%", left: "52%", transform: "translate(-50%, -50%)" }}
            >
              ?
            </span>
          </div>
        </div>

        {/* Rubric card */}
        <div className="w-full rounded-lg overflow-hidden shadow-md border border-slate-200 bg-white">
          {/* Navy header */}
          <div
            className="px-5 py-3 flex items-center gap-3"
            style={{ backgroundColor: "#1034B4" }}
          >
            <span
              className="font-display text-4xl text-white tracking-wide leading-none"
              style={{ fontFamily: "var(--app-font-display)" }}
            >
              404
            </span>
            <span className="text-white/70 text-sm font-medium">Catalyst Observation Tool</span>
          </div>

          {/* Card body */}
          <div className="px-5 py-4" style={{ fontFamily: "var(--app-font-sans)" }}>
            {/* Indicator row */}
            <div className="flex items-center justify-between py-3 border-b border-slate-100">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#FFB500" }}>
                  Indicator
                </span>
                <span className="text-sm font-semibold text-slate-800">Page Exists</span>
              </div>
              <div
                className="flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold text-white"
                style={{ backgroundColor: "#dc2626" }}
              >
                <span>0</span>
                <span className="font-normal opacity-75">/</span>
                <span>1</span>
              </div>
            </div>

            {/* Action Step */}
            <div className="pt-3">
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#FFB500" }}>
                Action Step
              </span>
              <p className="mt-1 text-sm text-slate-600">
                Check your URL or{" "}
                <Link
                  to="/"
                  className="font-semibold underline underline-offset-2"
                  style={{ color: "#1034B4" }}
                >
                  go back to the dashboard
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
