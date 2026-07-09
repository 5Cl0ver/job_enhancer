import { Users, UserCheck, UserPlus } from "lucide-react";
import { StatCard } from "@/components/analytics/StatCard";

interface StatsOverviewProps {
  totalUsers: number;
  active7d: number;
  active30d: number;
  new7d: number;
}

export function StatsOverview({ totalUsers, active7d, active30d, new7d }: StatsOverviewProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Total Users" value={totalUsers} icon={Users} />
      <StatCard label="Active (7d)" value={active7d} icon={UserCheck} />
      <StatCard label="Active (30d)" value={active30d} icon={UserCheck} />
      <StatCard label="New (7d)" value={new7d} icon={UserPlus} trend="up" />
    </div>
  );
}
