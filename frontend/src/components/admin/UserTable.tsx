import { useState } from "react";
import { format } from "date-fns";
import { MoreHorizontal, Shield, ShieldOff, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useAdminUsers,
  useUpdateUserRole,
  useRemoveUser,
} from "@/hooks/useAdmin";
import { useProfile } from "@/hooks/useProfile";
import type { AdminUserRow, UserProfile } from "@/types/api";

export function UserTable() {
  const [page, setPage] = useState(1);
  const { data: users = [], isLoading } = useAdminUsers(page);
  const { data: me } = useProfile();
  const updateRole = useUpdateUserRole();
  const removeUser = useRemoveUser();

  // The user pending a (destructive) removal — drives the confirm dialog.
  const [pendingRemove, setPendingRemove] = useState<UserProfile | null>(null);

  const confirmRemove = () => {
    if (!pendingRemove) return;
    removeUser.mutate(pendingRemove.id, {
      onSuccess: () => setPendingRemove(null),
    });
  };

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">Users</h2>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Setup</TableHead>
              <TableHead>Job Catcher</TableHead>
              <TableHead>Last active</TableHead>
              <TableHead>Today</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                  No users found.
                </TableCell>
              </TableRow>
            ) : (
              users.map((u) => {
                const isSelf = u.id === me?.id;
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.email}</TableCell>
                    <TableCell>{u.name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={u.role === "admin" ? "default" : "secondary"} className="capitalize">
                        {u.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <SetupTicks row={u} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {u.job_catcher ? (
                        <span
                          className={u.job_catcher.outdated ? "text-amber-700 dark:text-amber-300" : ""}
                          title={`Last seen ${format(new Date(u.job_catcher.last_seen_at), "MMM d, yyyy")}`}
                        >
                          {u.job_catcher.version}
                          {u.job_catcher.outdated ? " (old)" : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {u.last_active_at ? format(new Date(u.last_active_at), "MMM d") : "—"}
                    </TableCell>
                    <TableCell
                      className="whitespace-nowrap text-sm text-muted-foreground"
                      title={`This month: ${usageText(u.usage_month) || "nothing"}`}
                    >
                      {usageText(u.usage_today) || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {format(new Date(u.created_at), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="text-right">
                      {isSelf ? (
                        <span className="text-xs text-muted-foreground">You</span>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Actions for {u.email}</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              disabled={updateRole.isPending}
                              onClick={() =>
                                updateRole.mutate({
                                  userId: u.id,
                                  role: u.role === "admin" ? "user" : "admin",
                                })
                              }
                            >
                              {u.role === "admin" ? (
                                <>
                                  <ShieldOff className="h-4 w-4" />
                                  Make user
                                </>
                              ) : (
                                <>
                                  <Shield className="h-4 w-4" />
                                  Make admin
                                </>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setPendingRemove(u)}
                            >
                              <Trash2 className="h-4 w-4" />
                              Remove user
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={users.length < 25}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>

      {/* Destructive removal confirmation */}
      <Dialog
        open={!!pendingRemove}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {pendingRemove?.email}?</DialogTitle>
            <DialogDescription>
              Their account is deactivated immediately and permanently purged after
              30 days, along with their saved jobs, resumes, and generated
              documents. This cannot be undone after the grace period.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRemove(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={removeUser.isPending} onClick={confirmRemove}>
              {removeUser.isPending ? "Removing…" : "Remove user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const STEPS: [keyof AdminUserRow["onboarding"], string][] = [
  ["welcome_done", "Welcome"],
  ["resume", "Résumé"],
  ["profile", "Profile checked"],
  ["job_catcher", "Job Catcher"],
  ["first_job", "A saved job"],
  ["email", "Email updates"],
  ["claude", "Claude"],
];

/** One dot per setup step (spec 019): filled when done, named on hover. */
function SetupTicks({ row }: { row: AdminUserRow }) {
  const done = STEPS.filter(([key]) => row.onboarding[key]);
  return (
    <span
      className="flex gap-1"
      aria-label={`Setup: ${done.map(([, name]) => name).join(", ") || "nothing yet"}`}
    >
      {STEPS.map(([key, name]) => (
        <span
          key={key}
          title={`${name}: ${row.onboarding[key] ? "done" : "not yet"}`}
          className={`h-2.5 w-2.5 rounded-full ${row.onboarding[key] ? "bg-green-600" : "bg-muted"}`}
        />
      ))}
    </span>
  );
}

const SHORT: Record<string, string> = {
  live_search: "searches",
  ai_document: "AI docs",
  ai_read: "reads",
  ai_autofill: "AI fills",
};

/** {live_search: 2, ai_document: 1} → "2 searches · 1 AI docs". */
function usageText(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${n} ${SHORT[kind] ?? kind}`)
    .join(" · ");
}
