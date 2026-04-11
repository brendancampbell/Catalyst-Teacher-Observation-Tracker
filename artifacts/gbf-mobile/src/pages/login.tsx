import React, { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { useApp } from "@/context/AppContext";

const NAVY = "#1034B4";
const YELLOW = "#FFB500";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function LoginPage() {
  const { user, isLoading } = useAuth();
  const { selectedSchool, selectedRubric } = useApp();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && user) {
      const isNetworkAdmin = user.role === "NETWORK_ADMIN";
      if (!selectedSchool && isNetworkAdmin) {
        navigate("/school-picker");
      } else if (!selectedRubric) {
        navigate("/rubric-picker");
      } else {
        navigate("/observation");
      }
    }
  }, [isLoading, user, selectedSchool, selectedRubric]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: NAVY }}>
        <div className="w-8 h-8 border-4 border-blue-300 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: NAVY }}>
      <div style={{ height: 5, backgroundColor: YELLOW }} />

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 gap-8">
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center"
            style={{ backgroundColor: YELLOW }}
          >
            <span
              className="text-4xl font-bold"
              style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, letterSpacing: 2 }}
            >
              GBF
            </span>
          </div>
          <h1
            className="text-white text-center"
            style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, letterSpacing: "0.06em" }}
          >
            Get Better Faster
          </h1>
          <p className="text-blue-200 text-sm text-center">Principal Observation App</p>
        </div>

        <div className="w-full bg-white rounded-2xl p-6 shadow-2xl flex flex-col gap-5">
          <div>
            <h2
              className="text-2xl"
              style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, letterSpacing: "0.04em" }}
            >
              Welcome Back
            </h2>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">
              Sign in with your Uncommon Schools Google account to record classroom observations.
            </p>
          </div>

          <a
            href={`/api/auth/google?returnTo=${encodeURIComponent(BASE_URL + "/")}`}
            className="flex items-center gap-3 rounded-xl px-4 py-3.5 font-semibold text-white transition-opacity hover:opacity-90 active:opacity-80"
            style={{ backgroundColor: NAVY, textDecoration: "none" }}
          >
            <div className="w-7 h-7 bg-white rounded flex items-center justify-center shrink-0">
              <span className="font-bold text-base" style={{ color: NAVY }}>G</span>
            </div>
            <span style={{ fontFamily: "'Libre Franklin', sans-serif", fontSize: 16 }}>
              Sign in with Google
            </span>
          </a>

          <p className="text-xs text-slate-400 text-center">
            Access is restricted to provisioned Uncommon Schools accounts.
          </p>
        </div>

        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-0.5 rounded-full" style={{ backgroundColor: YELLOW }} />
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
            Uncommon Schools — GBF Tracker
          </p>
        </div>
      </div>
    </div>
  );
}
