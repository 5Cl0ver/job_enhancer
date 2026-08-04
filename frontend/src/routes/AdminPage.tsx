import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useProfile } from "@/hooks/useProfile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HealthPanel } from "@/components/admin/HealthPanel";
import { StatsOverview } from "@/components/admin/StatsOverview";
import { UserTable } from "@/components/admin/UserTable";
import { SignupTrendChart } from "@/components/admin/SignupTrendChart";
import { useAdminStats } from "@/hooks/useAdmin";

export default function AdminPage() {
  const { data: profile, isLoading } = useProfile();

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Role guard
  if (!profile || profile.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return <AdminDashboard />;
}

function AdminDashboard() {
  const { data: stats, isLoading } = useAdminStats();

  return (
    <div className="container mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Admin Dashboard</h1>
        <p className="text-sm text-muted-foreground">Platform health and user overview.</p>
      </div>

      {isLoading || !stats ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <StatsOverview
            totalUsers={stats.total_users}
            active7d={stats.active_7d}
            active30d={stats.active_30d}
            new7d={stats.new_7d}
          />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Daily Signups (Last 30 Days)</CardTitle>
            </CardHeader>
            <CardContent>
              <SignupTrendChart data={stats.signups_by_day} />
            </CardContent>
          </Card>

          <HealthPanel />
          <UserTable />
        </>
      )}
    </div>
  );
}
