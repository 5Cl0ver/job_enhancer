import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A load that failed: what didn't work, in plain words, and a way to try again. */
export function ErrorState({
  title,
  children,
  onRetry,
}: {
  title: string;
  children?: React.ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-lg border border-destructive/40 px-6 py-10 text-center"
    >
      <TriangleAlert className="h-7 w-7 text-destructive" aria-hidden />
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-sm text-sm text-muted-foreground">{children}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Try again
        </Button>
      )}
    </div>
  );
}
