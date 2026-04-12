import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/components/Dashboard";
import AdminPage from "@/pages/admin";
import ActionCenterPage from "@/pages/action-center";
import DistrictActionCenterPage from "@/pages/district-action-center";
import LoginPage from "@/pages/login";
import AccessDeniedPage from "@/pages/access-denied";
import { UserProvider, useUser } from "@/context/UserContext";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import { type ReactNode, useEffect } from "react";

const queryClient = new QueryClient();

const NAVY = "#1034B4";

function NetworkProtectedRoute({ children }: { children: ReactNode }) {
  const { currentUser, isLoading } = useUser();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && !currentUser) {
      navigate("/login");
    }
  }, [isLoading, currentUser, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#F4F6FB" }}>
        <div className="inline-block w-12 h-12 rounded-full border-4 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
      </div>
    );
  }

  if (!currentUser) return null;

  if (currentUser.role !== "NETWORK_LEADER" && currentUser.role !== "NETWORK_ADMIN") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-6" style={{ backgroundColor: "#F4F6FB" }}>
        <h2 className="text-2xl font-bold text-slate-700">Access Restricted</h2>
        <p className="text-slate-500 max-w-sm">This page is only available to Network Leaders and Network Admins.</p>
        <a href="/" className="mt-2 px-6 py-2 rounded-lg font-bold text-white" style={{ backgroundColor: NAVY }}>Back to Dashboard</a>
      </div>
    );
  }

  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { currentUser, isLoading } = useUser();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && !currentUser) {
      const authError = new URLSearchParams(window.location.search).get("auth_error");
      navigate(authError ? `/login?auth_error=${authError}` : "/login");
    }
  }, [isLoading, currentUser, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#F4F6FB" }}>
        <div className="inline-block w-12 h-12 rounded-full border-4 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
      </div>
    );
  }

  if (!currentUser) return null;

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/access-denied" component={AccessDeniedPage} />
      <Route path="/">
        <ProtectedRoute><Dashboard /></ProtectedRoute>
      </Route>
      <Route path="/admin">
        <ProtectedRoute><AdminPage /></ProtectedRoute>
      </Route>
      <Route path="/action-center">
        <ProtectedRoute><ActionCenterPage /></ProtectedRoute>
      </Route>
      <Route path="/district-action-center">
        <NetworkProtectedRoute><DistrictActionCenterPage /></NetworkProtectedRoute>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <UserProvider>
        <TooltipProvider>
          <ImpersonationBanner />
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </UserProvider>
    </QueryClientProvider>
  );
}

export default App;
