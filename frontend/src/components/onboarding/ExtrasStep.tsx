import { useState } from "react";
import { Link } from "react-router-dom";
import { Bot, MailCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const EXTRAS = [
  {
    key: "email",
    icon: MailCheck,
    title: "Email updates",
    text: "If job emails (interviews, rejections) come to one inbox, Job Enhancer can move your jobs along for you. Needs an app password; we show you how.",
    to: "/settings#email",
  },
  {
    key: "claude",
    icon: Bot,
    title: "Claude",
    text: "Have a Claude account? Connect it and Claude can search job sites for you (Claude Scout) and save what it finds. Not needed for anything else.",
    to: "/settings#claude",
  },
] as const;

/** Welcome step 3: extras for those who want them. Never required. */
export function ExtrasStep({ onNext }: { onNext: () => void }) {
  const [skipped, setSkipped] = useState<string[]>([]);
  return (
    <div className="flex flex-col gap-3">
      <Badge variant="secondary" className="self-start">Optional</Badge>
      {EXTRAS.map((x) => (
        <div
          key={x.key}
          className={cn("flex flex-col gap-2 rounded-lg border p-3", skipped.includes(x.key) && "opacity-50")}
        >
          <p className="flex items-center gap-2 font-medium">
            <x.icon className="h-4 w-4 text-primary" aria-hidden /> {x.title}
          </p>
          <p className="text-sm text-muted-foreground">{x.text}</p>
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to={x.to}>Set up</Link>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={skipped.includes(x.key)}
              onClick={() => setSkipped((s) => (s.includes(x.key) ? s : [...s, x.key]))}
            >
              Not now
            </Button>
          </div>
        </div>
      ))}
      <Button className="self-start" onClick={onNext}>
        Next
      </Button>
    </div>
  );
}
