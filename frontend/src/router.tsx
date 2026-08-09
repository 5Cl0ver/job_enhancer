import { createBrowserRouter, Navigate } from "react-router-dom";
import { DashboardLayout } from "@/routes/DashboardLayout";
import { Login } from "@/routes/Login";
import { AuthCallback } from "@/routes/AuthCallback";
import { SearchPage } from "@/routes/SearchPage";
import MyJobsPage from "@/routes/MyJobsPage";
import { JobDetailPage } from "@/routes/JobDetailPage";
import MatchesPage from "@/routes/MatchesPage";
import AnalyticsPage from "@/routes/AnalyticsPage";
import AiApplyPage from "@/routes/AiApplyPage";
import SettingsPage from "@/routes/SettingsPage";
import AdminPage from "@/routes/AdminPage";

// The app's "map": which URL renders which component.
// In Next.js this was implicit (folder names). Here it's explicit — you can
// read the entire routing structure of the app in one place.
export const router = createBrowserRouter([
  // Public routes (no dashboard shell)
  { path: "/login", element: <Login /> },
  // Supabase OAuth (e.g. GitHub) redirects back here.
  { path: "/auth/callback", element: <AuthCallback /> },

  // Protected app — DashboardLayout renders the sidebar + <Outlet/> for children
  {
    path: "/",
    element: <DashboardLayout />,
    children: [
      { index: true, element: <Navigate to="/search" replace /> },
      { path: "search", element: <SearchPage /> },
      // Saved + Tracker are one page now — same jobs, List/Board views.
      { path: "jobs", element: <MyJobsPage /> },
      { path: "jobs/:id", element: <JobDetailPage /> },
      { path: "saved", element: <Navigate to="/jobs" replace /> },
      { path: "tracker", element: <Navigate to="/jobs?view=board" replace /> },
      { path: "matches", element: <MatchesPage /> },
      { path: "analytics", element: <AnalyticsPage /> },
      { path: "ai-apply", element: <AiApplyPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "admin", element: <AdminPage /> },
    ],
  },

  // Anything else -> send to search
  { path: "*", element: <Navigate to="/search" replace /> },
]);
