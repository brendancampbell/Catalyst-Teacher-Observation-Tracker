import { useEffect } from "react";
import { useUser } from "@/context/UserContext";
import { useLocation } from "wouter";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";
const BASE   = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export default function LoginPage() {
  const { currentUser, isLoading } = useUser();
  const [, navigate] = useLocation();

  const params = new URLSearchParams(window.location.search);
  const authError = params.get("auth_error");

  useEffect(() => {
    if (!isLoading && currentUser) {
      navigate("/");
    }
  }, [isLoading, currentUser]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#F4F6FB" }}>
        <div className="inline-block w-12 h-12 rounded-full border-4 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 overflow-y-auto flex flex-col items-center justify-center px-4"
      style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}
    >
      <div style={{ height: 5, backgroundColor: YELLOW, position: "fixed", top: 0, left: 0, right: 0 }} />

      <div className="w-full max-w-sm flex flex-col items-center gap-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-6">
          {/* Logo + divider + Catalyst */}
          <div className="flex items-center gap-4">
            <img
              src="/uncommon-logo.png"
              alt="Uncommon Schools"
              className="h-16 w-auto object-contain"
              style={{ filter: "none" }}
            />
            <div style={{ width: 2, height: 64, backgroundColor: NAVY, borderRadius: 1, flexShrink: 0 }} />
            <h1
              className="uppercase"
              style={{
                color: NAVY,
                fontFamily: "'Bebas Neue', sans-serif",
                fontWeight: 700,
                fontSize: 52,
                letterSpacing: "0.05em",
                lineHeight: 1,
              }}
            >
              Catalyst
            </h1>
          </div>
          {/* Subtitle — stretched to match the row above */}
          <p
            className="uppercase text-center w-full"
            style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 22,
              letterSpacing: "0.1em",
              color: NAVY,
              marginTop: 2,
            }}
          >
            Teacher Observation Tool
          </p>
        </div>

        {/* Card */}
        <div
          className="w-full rounded-xl shadow-lg p-8 flex flex-col items-center gap-5"
          style={{ backgroundColor: "white", border: "1px solid #dde3f0" }}
        >
          <div className="text-center">
            <p className="font-semibold text-slate-700 text-lg">Sign in to your account</p>
            <p className="text-slate-400 text-sm mt-1">Use your Uncommon Schools Google account</p>
          </div>

          {authError === "access_denied" && (
            <div
              className="w-full rounded-lg px-4 py-3 text-sm text-center"
              style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c" }}
            >
              <strong>Access denied.</strong> Your Google account doesn't have access to this app.
              Contact your administrator to be provisioned.
            </div>
          )}

          <a
            href={`${BASE}/api/auth/google`}
            className="w-full flex items-center justify-center gap-3 font-bold rounded-lg px-4 py-3 transition-opacity hover:opacity-90"
            style={{
              backgroundColor: NAVY,
              color: "white",
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 16,
              letterSpacing: "0.04em",
              textDecoration: "none",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Sign in with Google
          </a>


        </div>
      </div>
    </div>
  );
}
