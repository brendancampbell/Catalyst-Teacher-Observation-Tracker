import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/context/AuthContext";
import { AppProvider } from "@/context/AppContext";
import LoginPage from "@/pages/login";
import SchoolPickerPage from "@/pages/school-picker";
import RubricPickerPage from "@/pages/rubric-picker";
import ObservationPage from "@/pages/observation";
import AccessDeniedPage from "@/pages/access-denied";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={LoginPage} />
      <Route path="/access-denied" component={AccessDeniedPage} />
      <Route path="/school-picker" component={SchoolPickerPage} />
      <Route path="/rubric-picker" component={RubricPickerPage} />
      <Route path="/observation" component={ObservationPage} />
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
