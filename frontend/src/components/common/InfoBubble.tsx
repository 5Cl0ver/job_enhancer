import { Popover } from "@base-ui/react/popover";
import { Info } from "lucide-react";
import { Link } from "react-router-dom";
import { HELP, type HelpKey } from "@/lib/help";
import { cn } from "@/lib/utils";

/**
 * The little ⓘ (spec 019, research R8): what something is, why it helps and
 * what it needs, right where it is. Opens on hover or click on a computer and
 * on tap on a phone; Esc or a press outside closes it. Base UI handles focus
 * and screen readers.
 */
export function InfoBubble({ topic, className }: { topic: HelpKey; className?: string }) {
  const help = HELP[topic];
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={150}
        aria-label={`About ${help.title}`}
        className={cn(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-9 pointer-coarse:w-9",
          className,
        )}
      >
        <Info className="h-4 w-4" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} collisionPadding={12} className="z-50">
          <Popover.Popup className="w-[min(280px,calc(100vw-24px))] rounded-lg border bg-popover p-3 text-sm font-normal text-popover-foreground shadow-lg outline-none">
            <Popover.Title className="mb-1 text-sm font-semibold">{help.title}</Popover.Title>
            <Popover.Description render={<div />} className="flex flex-col gap-1.5 text-muted-foreground">
              <p>
                <b className="font-medium text-foreground">What it is: </b>
                {help.what}
              </p>
              <p>
                <b className="font-medium text-foreground">Why it helps: </b>
                {help.why}
              </p>
              {"needs" in help && help.needs && (
                <p>
                  <b className="font-medium text-foreground">Needs: </b>
                  {help.needs}
                </p>
              )}
              {"more" in help && help.more && (
                <Link to={help.more} className="font-medium text-primary underline underline-offset-2">
                  Learn more →
                </Link>
              )}
            </Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
