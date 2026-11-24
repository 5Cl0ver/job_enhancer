import { createBrowserRouter, Navigate } from "react-router-dom";
import { DashboardLayout } from "@/routes/DashboardLayout";
import { Login } from "@/routes/Login";
import { AuthCallback } from "@/routes/AuthCallback";
import OAuthConsent from "@/routes/OAuthConsent";
import { SearchPage } from "@/routes/SearchPage";
import MyJobsPage from "@/routes/MyJobsPage";
import { JobDetailPage } from "@/routes/JobDetailPage";
import MatchesPage from "@/routes/MatchesPage";
import AnalyticsPage from "@/routes/AnalyticsPage";
import AiApplyPage from "@/routes/AiApplyPage";
import SettingsPage from "@/routes/SettingsPage";
import AutofillMemoryPage from "@/routes/AutofillMemoryPage";
import AdminPage from "@/routes/AdminPage";
import EmailUpdatesPage from "@/routes/EmailUpdatesPage";
import JobCatcherPage from "@/routes/JobCatcherPage";
import ConnectPage from "@/routes/ConnectPage";
import ForgotPasswordPage from "@/routes/ForgotPasswordPage";
import ResetPasswordPage from "@/routes/ResetPasswordPage";
import { useIsPhone } from "@/hooks/useIsPhone";

/** Where the app opens: on a phone you check on your jobs; at a desk you search. */
function Home() {
  return <Navigate to={useIsPhone() ? "/jobs" : "/search"} replace />;
}

// The app's "map": which URL renders which component.
// In Next.js this was implicit (folder names). Here it's explicit — you can
// read the entire routing structure of the app in one place.
export const router = createBrowserRouter([
  // Public routes (no dashboard shell)
  { path: "/login", element: <Login /> },
  // Supabase OAuth (e.g. GitHub) redirects back here.
  { path: "/auth/callback", element: <AuthCallback /> },
  // Claude connector consent screen (Supabase OAuth server redirects here).
  { path: "/oauth/consent", element: <OAuthConsent /> },
  // Approve a Job Catcher (checks sign-in itself, like the consent screen).
  { path: "/connect", element: <ConnectPage /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },

  // Protected app — DashboardLayout renders the sidebar + <Outlet/> for children
  {
    path: "/",
    element: <DashboardLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: "search", element: <SearchPage /> },
      // Saved + Tracker are one page now — same jobs, List/Board views.
      { path: "jobs", element: <MyJobsPage /> },
      { path: "jobs/:id", element: <JobDetailPage /> },
      { path: "saved", element: <Navigate to="/jobs" replace /> },
      { path: "tracker", element: <Navigate to="/jobs?view=board" replace /> },
      { path: "matches", element: <MatchesPage /> },
      { path: "email-updates", element: <EmailUpdatesPage /> },
      { path: "analytics", element: <AnalyticsPage /> },
      { path: "ai-apply", element: <AiApplyPage /> },
      { path: "autofill", element: <AutofillMemoryPage /> },
      { path: "job-catcher", element: <JobCatcherPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "admin", element: <AdminPage /> },
    ],
  },

  // Anything else -> the app's start page
  { path: "*", element: <Navigate to="/" replace /> },
]);
