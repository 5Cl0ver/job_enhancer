import { createBrowserRouter, Navigate } from "react-router-dom";
import { DashboardLayout } from "@/routes/DashboardLayout";
import { Login } from "@/routes/Login";
import { AuthCallback } from "@/routes/AuthCallback";
import OAuthConsent from "@/routes/OAuthConsent";
import { SearchPage } from "@/routes/SearchPage";
import MyJobsPage from "@/routes/MyJobsPage";
import { JobDetailPage } from "@/routes/JobDetailPage";
import { ApplyRunPage } from "@/routes/ApplyRunPage";
import MatchesPage from "@/routes/MatchesPage";
import AnalyticsPage from "@/routes/AnalyticsPage";
import AiApplyPage from "@/routes/AiApplyPage";
import SettingsPage from "@/routes/SettingsPage";
import AutofillMemoryPage from "@/routes/AutofillMemoryPage";
import AdminPage from "@/routes/AdminPage";
import AdminBugsPage from "@/routes/AdminBugsPage";
import EmailUpdatesPage from "@/routes/EmailUpdatesPage";
import JobCatcherPage from "@/routes/JobCatcherPage";
import ConnectPage from "@/routes/ConnectPage";
import ForgotPasswordPage from "@/routes/ForgotPasswordPage";
import ResetPasswordPage from "@/routes/ResetPasswordPage";
import WelcomePage from "@/routes/WelcomePage";
import { CrashScreen } from "@/components/bugs/CrashScreen";
import { RequireAuth } from "@/routes/RequireAuth";
import { useIsPhone } from "@/hooks/useIsPhone";
import { useOnboarding } from "@/hooks/useOnboarding";

/**
 * Where the app opens: a new account's Welcome (spec 019) until it's finished
 * or skipped; then on a phone you check on your jobs, at a desk you search.
 * Only the front door does this, so links, new tabs and Job Catcher's "Open
 * in app" always land where they point.
 */
export function Home() {
  const phone = useIsPhone();
  const { data, isLoading } = useOnboarding();
  if (isLoading) return null;
  if (data && !data.welcome.done) return <Navigate to="/welcome" replace />;
  return <Navigate to={phone ? "/jobs" : "/search"} replace />;
}

// A page that breaks shows the crash screen (spec 032) and is reported.
const crash = <CrashScreen />;

// The app's "map": which URL renders which component.
// In Next.js this was implicit (folder names). Here it's explicit — you can
// read the entire routing structure of the app in one place.
export const router = createBrowserRouter([
  // Public routes (no dashboard shell)
  { path: "/login", element: <Login />, errorElement: crash },
  // Supabase OAuth (e.g. GitHub) redirects back here.
  { path: "/auth/callback", element: <AuthCallback />, errorElement: crash },
  // Claude connector consent screen (Supabase OAuth server redirects here).
  { path: "/oauth/consent", element: <OAuthConsent />, errorElement: crash },
  // Approve a Job Catcher (checks sign-in itself, like the consent screen).
  { path: "/connect", element: <ConnectPage />, errorElement: crash },
  {
    path: "/forgot-password",
    element: <ForgotPasswordPage />,
    errorElement: crash,
  },
  {
    path: "/reset-password",
    element: <ResetPasswordPage />,
    errorElement: crash,
  },
  // The Welcome (spec 019): full-page, no sidebar, signed in only.
  {
    path: "/welcome",
    element: (
      <RequireAuth>
        <WelcomePage />
      </RequireAuth>
    ),
    errorElement: crash,
  },

  // Protected app — DashboardLayout renders the sidebar + <Outlet/> for children
  {
    path: "/",
    element: <DashboardLayout />,
    // The frame itself broke: the whole screen.
    errorElement: crash,
    children: [
      {
        // A page broke: the crash screen in its place, the menu still there.
        errorElement: crash,
        children: [
          { index: true, element: <Home /> },
          { path: "search", element: <SearchPage /> },
          // Saved + Tracker are one page now — same jobs, List/Board views.
          { path: "jobs", element: <MyJobsPage /> },
          { path: "jobs/:id", element: <JobDetailPage /> },
          { path: "apply/:runId", element: <ApplyRunPage /> },
          { path: "saved", element: <Navigate to="/jobs" replace /> },
          {
            path: "tracker",
            element: <Navigate to="/jobs?view=board" replace />,
          },
          { path: "matches", element: <MatchesPage /> },
          { path: "email-updates", element: <EmailUpdatesPage /> },
          { path: "analytics", element: <AnalyticsPage /> },
          { path: "ai-apply", element: <AiApplyPage /> },
          { path: "autofill", element: <AutofillMemoryPage /> },
          { path: "job-catcher", element: <JobCatcherPage /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "admin", element: <AdminPage /> },
          { path: "admin/bugs", element: <AdminBugsPage /> },
        ],
      },
    ],
  },

  // Anything else -> the app's start page
  { path: "*", element: <Navigate to="/" replace /> },
]);
