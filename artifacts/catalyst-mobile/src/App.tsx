import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/context/AuthContext";
import { AppProvider } from "@/context/AppContext";
import { HttpError } from "@/lib/api";
import LoginPage from "@/pages/login";
import SchoolPickerPage from "@/pages/school-picker";
import RubricPickerPage from "@/pages/rubric-picker";
import ObservationPage from "@/pages/observation";
import DraftsPage from "@/pages/drafts";
import AccessDeniedPage from "@/pages/access-denied";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /* Never retry 401s — the centralized handler in AuthProvider already
         triggered a redirect; retrying would fire the handler again.       */
      retry: (failureCount, error) => {
        if (error instanceof HttpError && error.status === 401) return false;
        return failureCount < 1;
      },
      staleTime: 30_000,
      /* Prevent React Query from surfacing 401 errors as query error state
         (the page is already navigating away when this fires).             */
      throwOnError: (error: unknown) =>
        !(error instanceof HttpError && error.status === 401),
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={LoginPage} />
      <Route path="/access-denied" component={AccessDeniedPage} />
      <Route path="/school-picker" component={SchoolPickerPage} />
      <Route path="/rubric-picker" component={RubricPickerPage} />
      <Route path="/observation" component={ObservationPage} />
      <Route path="/drafts" component={DraftsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </AppProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
