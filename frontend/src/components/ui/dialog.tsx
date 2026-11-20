import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // `max-w-lg` is unprefixed so a caller's own width (max-w-2xl,
        // sm:max-w-sm) replaces it. The one column may shrink to the box, so
        // long content (a file name in a select) can't make the dialog scroll
        // sideways.
        "fixed z-50 grid w-full max-w-lg grid-cols-[minmax(0,1fr)] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        // From 768px: a box in the middle of the screen.
        "md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:shadow-2xl md:data-[state=closed]:zoom-out-95 md:data-[state=open]:zoom-in-95",
        className,
        // On a phone: a sheet that slides up from the bottom, as wide as the
        // screen and clear of the home indicator. Its frame (grab bar, close
        // button) stays put; the content below scrolls. After `className` and
        // forced, so a dialog's desktop width, height or scrolling can't break
        // the sheet.
        "max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:flex! max-md:flex-col max-md:w-full! max-md:max-w-none! max-md:max-h-[92dvh]! max-md:overflow-hidden! max-md:rounded-t-2xl max-md:border-x-0 max-md:border-b-0 max-md:pb-[calc(1.5rem+env(safe-area-inset-bottom))]! max-md:data-[state=closed]:slide-out-to-bottom max-md:data-[state=open]:slide-in-from-bottom",
      )}
      {...props}
    >
      {/* The grab bar that says "this is a sheet". */}
      <div
        className="mx-auto -mb-1 -mt-2 h-1.5 w-10 shrink-0 rounded-full bg-muted md:hidden"
        aria-hidden
      />
      {/* From 768px this wrapper isn't there (`contents`): the children sit
          straight in the box's grid. On a phone it is the part that scrolls;
          the side padding leaves room for focus rings. */}
      <div className="md:contents max-md:-mx-1 max-md:grid max-md:min-h-0 max-md:gap-[inherit] max-md:overflow-y-auto max-md:overflow-x-hidden max-md:px-1">
        {children}
      </div>
      <DialogPrimitive.Close className="absolute right-3 top-3 rounded-sm p-1 opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground pointer-coarse:p-3">
        <XIcon className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col space-y-1.5 text-center sm:text-left",
        className,
      )}
      {...props}
    />
  );
}
DialogHeader.displayName = "DialogHeader";

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-0 sm:space-x-2",
        // On a phone the buttons stay in reach while the sheet's content scrolls.
        "max-md:sticky max-md:bottom-0 max-md:border-t max-md:bg-background max-md:pt-3",
        className,
      )}
      {...props}
    />
  );
}
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
