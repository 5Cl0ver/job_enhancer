/**
 * "Appearance" — the Settings card for choosing the app theme.
 *
 * A three-way segmented control: Light / Dark / System. "System" follows the
 * OS preference and keeps following it live. The choice is remembered across
 * sessions (localStorage, handled by the ThemeProvider).
 */
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type Theme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function AppearanceCard() {
  const { theme, setTheme } = useTheme();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Appearance</CardTitle>
        <CardDescription>
          Choose how Job Enhancer looks. “System” matches your device’s light or dark setting.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          role="radiogroup"
          aria-label="Theme"
          className="grid grid-cols-3 gap-2 rounded-lg border p-1"
        >
          {OPTIONS.map(({ value, label, icon: Icon }) => {
            const active = theme === value;
            return (
              <Button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                variant={active ? "secondary" : "ghost"}
                onClick={() => setTheme(value)}
                className={cn("h-9 gap-2", active && "shadow-sm")}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
