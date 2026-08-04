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
import type { UserProfile } from "@/types/api";

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
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
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
                    <TableCell className="text-sm text-muted-foreground">
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
