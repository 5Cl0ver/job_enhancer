"use client";

import { Bookmark, Send, MessagesSquare, BarChart2, Loader2 } from "lucide-react";
import { StatCard } from "@/components/analytics/StatCard";
import { ActivityChart } from "@/components/analytics/ActivityChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAnalyticsSummary } from "@/hooks/useAnalytics";

export default function AnalyticsPage() {
  const { data, isLoading, isError } = useAnalyticsSummary();

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-6">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center text-sm text-destructive">
          Failed to load analytics. Please refresh the page.
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground">Your job search at a glance.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Jobs Saved" value={data.total_saved} icon={Bookmark} />
        <StatCard label="Applications Sent" value={data.total_applied} icon={Send} />
        <StatCard
          label="Response Rate"
          value={data.response_rate}
          suffix="%"
          icon={BarChart2}
          trend={data.response_rate >= 20 ? "up" : data.response_rate > 0 ? "neutral" : "down"}
        />
        <StatCard label="Interviews" value={data.total_interviews} icon={MessagesSquare} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Applications per Week (Last 8 Weeks)</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityChart data={data.weekly_activity} />
        </CardContent>
      </Card>
    </div>
  );
}
