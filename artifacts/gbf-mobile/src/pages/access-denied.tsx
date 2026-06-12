const NAVY = "#1034B4";
const YELLOW = "#FFB500";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function AccessDeniedPage() {
  return (
    <div
      className="fixed inset-0 overflow-y-auto flex flex-col items-center justify-center px-4"
      style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}
    >
      <div style={{ height: 5, backgroundColor: YELLOW, position: "fixed", top: 0, left: 0, right: 0 }} />

      <div className="w-full max-w-sm flex flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-3">
          <img
            src="/uncommon-logo.png"
            alt="Uncommon Schools"
            className="h-16 w-auto object-contain"
          />
          <h1
            className="uppercase tracking-widest text-center"
            style={{
              color: NAVY,
              fontFamily: "'Bebas Neue', sans-serif",
              fontWeight: 700,
              fontSize: 28,
              letterSpacing: "0.06em",
            }}
          >
            Catalyst
          </h1>
          <p
            className="text-white uppercase text-center"
            style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 16,
              letterSpacing: "0.08em",
              marginTop: 2,
            }}
          >
            Teacher Observation Tool
          </p>
        </div>

        <div
          className="w-full rounded-xl shadow-lg p-8 flex flex-col items-center gap-5"
          style={{ backgroundColor: "white", border: "1px solid #dde3f0" }}
        >
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "#fef2f2", border: "2px solid #fecaca" }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>

          <div className="text-center flex flex-col gap-2">
            <p className="font-semibold text-slate-800 text-lg">Access Denied</p>
            <p className="text-slate-500 text-sm leading-relaxed">
              We're sorry — your Google account doesn't have access to Catalyst.
            </p>
            <p className="text-slate-500 text-sm leading-relaxed">
              If you believe this is a mistake, please contact your <strong className="text-slate-700">Director of Operations (DOO)</strong> to be provisioned.
            </p>
          </div>

          <a
            href={`${BASE_URL}/`}
            className="w-full flex items-center justify-center gap-2 font-bold rounded-lg px-4 py-3 transition-opacity hover:opacity-90"
            style={{
              backgroundColor: NAVY,
              color: "white",
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 16,
              letterSpacing: "0.04em",
              textDecoration: "none",
            }}
          >
            Back to Sign In
          </a>
        </div>
      </div>
    </div>
  );
}
