import { Link, Navigate } from "react-router-dom";
import { Bug, ChevronRight, Loader2 } from "lucide-react";
import { useProfile } from "@/hooks/useProfile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HealthPanel } from "@/components/admin/HealthPanel";
import { StatsOverview } from "@/components/admin/StatsOverview";
import { UserTable } from "@/components/admin/UserTable";
import { AllowancesCard } from "@/components/admin/AllowancesCard";
import { SignupTrendChart } from "@/components/admin/SignupTrendChart";
import { useAdminStats } from "@/hooks/useAdmin";
import { useAttention } from "@/hooks/useAttention";

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

/** The way into Bugs & ideas (spec 032), with how many new bugs wait. */
function BugsEntry() {
  const { data } = useAttention();
  const fresh = data?.bugs_new ?? 0;
  return (
    <Link
      to="/admin/bugs"
      className="flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors active:bg-accent md:hover:bg-accent/60"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Bug className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">Bugs &amp; ideas</span>
        <span className="block text-sm text-muted-foreground">
          {fresh ? `${fresh} new ${fresh === 1 ? "bug" : "bugs"}` : "Nothing new. Every bug and idea, in one place."}
        </span>
      </span>
      <ChevronRight className="h-5 w-5 text-muted-foreground" aria-hidden />
    </Link>
  );
}

function AdminDashboard() {
  const { data: stats, isLoading } = useAdminStats();

  return (
    <div className="container mx-auto max-w-6xl space-y-6 md:px-4 md:py-6">
      <div className="space-y-1 max-md:hidden">
        <h1 className="text-2xl font-bold tracking-tight">Admin Dashboard</h1>
        <p className="text-sm text-muted-foreground">Platform health and user overview.</p>
      </div>

      <BugsEntry />

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
          <AllowancesCard />
        </>
      )}
    </div>
  );
}
