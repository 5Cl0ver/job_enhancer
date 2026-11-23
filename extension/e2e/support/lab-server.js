// Serves the invented application pages in test/lab/ (and the saved board
// fixtures in test/fixtures/). The same server is reachable as both
// http://localhost:PORT and http://127.0.0.1:PORT — two different origins, which
// is how the lab gets a real "form embedded from another site" frame.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { buildSync } from "esbuild";
import { ROOT } from "./launch.js";

/** Build the lab's React form (test/lab/react-form/main.jsx → app.js). */
function buildReactForm() {
  const dir = join(ROOT, "test", "lab", "react-form");
  buildSync({
    entryPoints: [join(dir, "main.jsx")],
    outfile: join(dir, "app.js"),
    bundle: true,
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": "\"production\"" },
    logLevel: "error",
  });
}

const DIRS = { "/lab/": join(ROOT, "test", "lab"), "/fixtures/": join(ROOT, "test", "fixtures") };
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

export async function startLabServer() {
  buildReactForm();
  const submissions = []; // forms the TEST submitted (the extension never does)
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url || "/").split("?")[0]);
    if (req.method === "POST" && path === "/__submit") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      submissions.push(Buffer.concat(chunks).toString("utf8"));
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><title>Submitted</title><h1>Application submitted</h1>");
      return;
    }
    const prefix = Object.keys(DIRS).find((p) => path.startsWith(p));
    const file = prefix && normalize(join(DIRS[prefix], path.slice(prefix.length)));
    if (!file || !file.startsWith(DIRS[prefix]) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  return {
    /** The page's URL on the main lab origin. */
    url: (p) => `http://localhost:${port}${p}`,
    /** The same page on the second origin (for cross-site frames). */
    otherOrigin: (p) => `http://127.0.0.1:${port}${p}`,
    submissions,
    close: () => new Promise((r) => server.close(r)),
  };
}
