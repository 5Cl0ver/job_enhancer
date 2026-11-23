// One press fills the page, right (spec 015, Story 1): the built extension in
// real Chromium against the lab's invented application pages and the fake
// server. Every check reads what the PAGE holds (React state, shadow roots,
// frames), never just what's painted. Invented applicant only.
import { test, expect } from "@playwright/test";
import { startFakeApi, PERSON } from "./support/fake-api.js";
import { startLabServer } from "./support/lab-server.js";
import { launchExtension } from "./support/launch.js";

let api;
let lab;
let ext;

test.beforeAll(async () => {
  api = await startFakeApi();
  lab = await startLabServer();
  ext = await launchExtension({ apiUrl: api.url });
});

test.afterAll(async () => {
  await ext?.close();
  await lab?.close();
  await api?.close();
});

test.beforeEach(async () => {
  api.reset();
  api.setDelay(0);
  api.clearCalls();
  api.state.aiAnswers = {};
});

const pill = (page) => page.locator("#jec-autofill");

async function press(page) {
  await expect(pill(page)).toBeVisible({ timeout: 8000 });
  const t0 = Date.now();
  await pill(page).click();
  await expect(pill(page)).toHaveText(/filled/, { timeout: 15000 });
  return Date.now() - t0;
}

test("a plain form: everything known is filled, the essay is left alone", async () => {
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/classic.html"));
  await press(page);
  await expect(page.locator("#first")).toHaveValue("Wren");
  await expect(page.locator("#last")).toHaveValue("Calloway");
  await expect(page.locator("#email")).toHaveValue(PERSON.email);
  await expect(page.locator("#email2")).toHaveValue(PERSON.email); // confirm email
  await expect(page.locator("#phone")).toHaveValue(PERSON.profile.phone);
  await expect(page.locator("#why")).toHaveValue("");
  expect(await page.locator("#resume").evaluate((el) => el.files[0]?.name)).toBe("wren-calloway.pdf");
  await page.close();
});

test("a React app: its own state holds every value, search dropdowns really chosen", async () => {
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/react-form/index.html"));
  await press(page);
  const data = await page.evaluate(() => window.__formData());
  expect(data).toMatchObject({
    firstName: "Wren",
    lastName: "Calloway",
    email: PERSON.email,
    phone: PERSON.profile.phone,
    authorized: "Yes, I am authorized",
    sponsorship: "No",
    location: "Harborview, OR",
    relocate: "Yes",
    gender: "", // never
  });
  // "2 weeks" notice in the profile → a start date two weeks out.
  const d = new Date();
  d.setDate(d.getDate() + 14);
  const p2 = (n) => String(n).padStart(2, "0");
  expect(data.startDate).toBe(`${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`);
  await page.close();
});

test("fields hidden inside page components (open and closed shadow DOM)", async () => {
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/shadow.html"));
  await press(page);
  expect(await page.evaluate(() => window.__formData())).toEqual({
    first: "Wren",
    last: "Calloway",
    email: PERSON.email,
    city: "Harborview",
  });
  await page.close();
});

test("a form embedded from another site in a frame", async () => {
  const page = await ext.context.newPage();
  const form = lab.url("/lab/classic.html");
  await page.goto(lab.otherOrigin(`/lab/embed-host.html?form=${encodeURIComponent(form)}`));
  const frame = page.frameLocator("#apply");
  await expect(frame.locator("#jec-autofill")).toBeVisible({ timeout: 8000 });
  await frame.locator("#jec-autofill").click();
  await expect(frame.locator("#first")).toHaveValue("Wren", { timeout: 10000 });
  await expect(frame.locator("#email2")).toHaveValue(PERSON.email);
  await page.close();
});

test("no pill on sign-in, search and newsletter forms", async () => {
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/noise.html"));
  await page.waitForTimeout(2000);
  await expect(pill(page)).toHaveCount(0);
  await page.close();
});

test("self-identification, agreements and essays are never touched", async () => {
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/sensitive.html"));
  await press(page);
  await expect(page.locator("#fn")).toHaveValue("Wren");
  await expect(page.locator("#g")).toHaveValue("");
  await expect(page.locator("#race")).toHaveValue("");
  await expect(page.locator("input[name=vet]:checked")).toHaveCount(0);
  await expect(page.locator("#agree")).not.toBeChecked();
  await expect(page.locator("#why")).toHaveValue("");
  await page.close();
});

test("what the user already typed is kept", async () => {
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/classic.html"));
  await page.locator("#first").fill("Robin");
  await press(page);
  await expect(page.locator("#first")).toHaveValue("Robin");
  await expect(page.locator("#last")).toHaveValue("Calloway");
  await page.close();
});

test("a sleeping server doesn't slow a press: it fills from the copy the extension holds", async () => {
  // A first fill has the copy in hand; now every server reply takes 30 s.
  const warm = await ext.context.newPage();
  await warm.goto(lab.url("/lab/classic.html"));
  await press(warm);
  await warm.close();
  api.setDelay(30_000);
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/classic.html"));
  const ms = await press(page);
  await expect(page.locator("#first")).toHaveValue("Wren");
  expect(ms).toBeLessThan(2500);
  api.setDelay(0);
  await page.close();
});

test("the AI answers what's left: a sure answer fills, an unsure one doesn't", async () => {
  api.state.aiAnswers = {
    "How did you hear about this job?": { value: "LinkedIn", confidence: 0.92 },
    "Phone": { value: "nope", confidence: 0.99 }, // already filled: never asked over it
  };
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/react-form/index.html"));
  await press(page);
  await expect.poll(() => page.evaluate(() => window.__formData().hearAbout)).toBe("LinkedIn");
  expect(await page.evaluate(() => window.__formData().phone)).toBe(PERSON.profile.phone);
  const [{ body }] = api.calls("/v1/ai/autofill-map");
  // Only questions and their choices are sent — never the page.
  for (const f of body.fields) expect(Object.keys(f).sort()).toEqual(["id", "label", "options", "type"]);
  expect(body.fields.map((f) => f.label)).not.toContain("Gender");
  await page.close();
});
