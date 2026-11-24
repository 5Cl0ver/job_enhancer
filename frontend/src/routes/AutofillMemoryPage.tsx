import { useEffect, useRef } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { ApplicationProfileCard } from "@/components/settings/ApplicationProfileCard";
import { SavedAnswersCard } from "@/components/settings/SavedAnswersCard";
import { TaughtBoxesCard } from "@/components/autofill/TaughtBoxesCard";
import { ResumeDetailsCard } from "@/components/autofill/ResumeDetailsCard";
import { LanguagesCard } from "@/components/autofill/LanguagesCard";
import { InfoBubble } from "@/components/common/InfoBubble";

/**
 * Autofill memory (spec 018): everything Job Catcher fills from and learns,
 * in one place — the profile, the answers it saved as you applied (everyday,
 * per company, essays), and the boxes you taught it. Edit or remove anything;
 * the extension picks changes up on its next fill. The side panel's
 * "Edit in app" opens this page filtered to one answer (?q=).
 */
export default function AutofillMemoryPage() {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const { hash } = useLocation();
  const profileRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hash === "#profile") profileRef.current?.scrollIntoView?.({ block: "start" });
  }, [hash]);
  return (
    <div className="container mx-auto flex max-w-2xl flex-col gap-3 md:gap-6 md:px-4 md:py-6">
      <div className="space-y-1 max-md:hidden">
        <h1 className="flex items-center gap-1 text-2xl font-bold tracking-tight">Autofill memory <InfoBubble topic="autofill" /></h1>
        <p className="text-sm text-muted-foreground">
          Everything Job Catcher fills applications with, and everything it learned while
          you applied. Change or remove anything; your next application uses it.
        </p>
      </div>
      {/* Getting started's "Check your profile" opens here (#profile). */}
      <div id="profile" ref={profileRef} className="scroll-mt-16">
        <ApplicationProfileCard />
      </div>
      <ResumeDetailsCard />
      <LanguagesCard />
      <SavedAnswersCard initialQuery={q} />
      <TaughtBoxesCard />
    </div>
  );
}
