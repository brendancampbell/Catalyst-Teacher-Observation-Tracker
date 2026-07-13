import { Switch, Route, Router as WouterRouter, useLocation, useParams } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/components/Dashboard";
import AdminPage from "@/pages/admin";
import ActionCenterPage from "@/pages/action-center";
import DraftsPage from "@/pages/drafts";
import LoginPage from "@/pages/login";
import AccessDeniedPage from "@/pages/access-denied";
import TeacherProfilePage from "@/pages/TeacherProfile";
import { UserProvider, useUser } from "@/context/UserContext";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import { HttpError } from "@/lib/api";
import { type ReactNode, useEffect } from "react";

function TeacherProfileRoute() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const teacherName = new URLSearchParams(window.location.search).get("name") ?? undefined;
  return <TeacherProfilePage employeeId={employeeId ?? ""} teacherName={teacherName} />;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /* Never retry 401s — the centralized handler in UserProvider already
         triggered a redirect; retrying would fire the handler again.       */
      retry: (failureCount, error) => {
        if (error instanceof HttpError && error.status === 401) return false;
        return failureCount < 3;
      },
      /* Prevent React Query from surfacing 401 errors as query error state
         (the page is already navigating away when this fires).             */
      throwOnError: (error: unknown) =>
        !(error instanceof HttpError && error.status === 401),
    },
  },
});

const NAVY = "#1034B4";

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
      <Route path="/drafts">
        <ProtectedRoute><DraftsPage /></ProtectedRoute>
      </Route>
      <Route path="/teacher/:employeeId">
        <ProtectedRoute><TeacherProfileRoute /></ProtectedRoute>
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
          <div className="h-full flex flex-col overflow-hidden">
            <ImpersonationBanner />
            <div className="flex-1 min-h-0 overflow-hidden">
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <Router />
              </WouterRouter>
            </div>
          </div>
          <Toaster />
        </TooltipProvider>
      </UserProvider>
    </QueryClientProvider>
  );
}

export default App;
