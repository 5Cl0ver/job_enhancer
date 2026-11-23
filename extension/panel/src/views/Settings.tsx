// "Settings": the account, the Claude Project link, and where things are.
import * as React from "react";
import { ExternalLink, LogOut } from "lucide-react";
import { Button, Card, Field, Input, Muted, SectionTitle } from "@/ui";
import { appUrl, send } from "@/lib/chrome";
import { usePanel } from "@/lib/store";

export function Settings() {
  const { auth, signedOut, claudeUrl, setClaudeUrl } = usePanel();
  const [leaving, setLeaving] = React.useState(false);
  const version = chrome.runtime.getManifest().version;

  async function signOut() {
    setLeaving(true);
    await send({ type: "signOut" });
    signedOut();
  }

  return (
    <div className="flex flex-col gap-3">
      <SectionTitle>Settings</SectionTitle>

      <Card className="flex flex-col gap-2">
        <Muted className="font-medium uppercase tracking-wide">Account</Muted>
        <p className="truncate font-medium">{auth.email || "Signed in"}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => chrome.tabs.create({ url: appUrl() })}>
            <ExternalLink />
            Open Job Enhancer
          </Button>
          <Button variant="ghost" size="sm" onClick={signOut} busy={leaving}>
            {!leaving && <LogOut />}Sign out
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-2">
        <Field label="Claude Project link">
          {(id) => (
            <Input
              id={id}
              placeholder="https://claude.ai/project/…"
              spellCheck={false}
              value={claudeUrl}
              onChange={(e) => setClaudeUrl(e.target.value)}
            />
          )}
        </Field>
        <Muted>Write › My Claude opens your drafts here. The same link is used in the app.</Muted>
      </Card>

      <Muted className="text-center">Job Catcher v{version}</Muted>
    </div>
  );
}
