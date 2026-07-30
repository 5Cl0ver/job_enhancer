// A temporary stand-in for a real page. Each of these gets replaced by the
// actual ported page (Search, Tracker, etc.) in the component-porting step (M5).
export function Placeholder({ name }: { name: string }) {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">{name}</h1>
      <p className="mt-2 text-muted-foreground">
        This page is scaffolded and routing works. Its real content gets ported
        from the Next.js version in the next step of the migration.
      </p>
      <div className="mt-6 rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        {name} — content coming soon
      </div>
    </div>
  );
}
