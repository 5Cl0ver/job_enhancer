import { Toaster as Sonner } from "sonner";
import { useTheme } from "@/components/theme-provider";

/** The app's toasts: short messages after an action, with Retry when it failed. */
export function Toaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme}
      position="bottom-right"
      richColors
      closeButton
      // Clear the phone's bottom tab bar.
      mobileOffset={{ bottom: 76 }}
    />
  );
}
