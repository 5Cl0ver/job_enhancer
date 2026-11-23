// Review everything, in one place (spec 015, Story 2): after a fill, the side
// panel lists every field with where its answer came from; Fix, Undo, Undo all
// and Answer change what the PAGE holds; answers given are remembered.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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

test.beforeEach(() => {
  api.reset();
  api.clearCalls();
  api.state.answers = [];
  api.state.bundleVersion++;
});

/** A filled React application, with the side panel open beside it. */
async function filledWithPanel() {
  const url = lab.url("/lab/react-form/index.html");
  const page = await ext.context.newPage();
  await page.goto(url);
  await page.locator("#jec-autofill").click();
  await expect(page.locator("#jec-autofill")).toHaveText(/filled/, { timeout: 15000 });
  const tabId = await ext.worker.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, url);
  const panel = await ext.context.newPage();
  await panel.setViewportSize({ width: 380, height: 900 });
  await panel.goto(`chrome-extension://${ext.extensionId}/dist/panel/index.html?tab=${tabId}`);
  const form = () => page.evaluate(() => window.__formData());
  return { page, panel, form };
}

test("the panel lists every field it filled and what's left for you", async () => {
  const { page, panel } = await filledWithPanel();
  await expect(panel.getByText(/filled/).first()).toBeVisible();
  await expect(panel.getByText("Needs you")).toBeVisible();
  await expect(panel.getByRole("listitem").filter({ hasText: "How did you hear about this job?" })).toBeVisible();
  await expect(panel.getByRole("listitem").filter({ hasText: "Gender" })).toContainText("Only you answer this");
  await panel.getByRole("button", { name: /filled from your profile/ }).click();
  const first = panel.getByRole("listitem").filter({ hasText: "First name" });
  await expect(first).toContainText("Wren");
  await expect(first).toContainText("Profile");
  for (const scheme of ["light", "dark"]) {
    await panel.emulateMedia({ colorScheme: scheme });
    await panel.waitForTimeout(400); // the theme switch fades colors
    const { violations } = await new AxeBuilder({ page: panel }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(violations.map((v) => `${scheme}: ${v.id} — ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
  }
  await panel.screenshot({ path: process.env.JEC_SHOT || "test-results/review.png", fullPage: true });
  await Promise.all([page.close(), panel.close()]);
});

test("Fix changes the page — a search dropdown included — and Undo puts it back", async () => {
  const { page, panel, form } = await filledWithPanel();
  await panel.getByRole("button", { name: /filled from your profile/ }).click();

  const auth = panel.getByRole("listitem").filter({ hasText: "legally authorized" });
  await auth.getByRole("button", { name: /^Fix/ }).click();
  await auth.getByRole("combobox").selectOption("No, I am not authorized");
  await auth.getByRole("button", { name: "Apply" }).click();
  await expect.poll(async () => (await form()).authorized).toBe("No, I am not authorized");

  const first = panel.getByRole("listitem").filter({ hasText: "First name" });
  await first.getByRole("button", { name: /^Undo/ }).click();
  await expect.poll(async () => (await form()).firstName).toBe("");
  await Promise.all([page.close(), panel.close()]);
});

test("Undo all restores every field it can", async () => {
  const { page, panel, form } = await filledWithPanel();
  await panel.getByRole("button", { name: "Undo all" }).click();
  await expect.poll(async () => (await form()).email).toBe("");
  const after = await form();
  expect(after.firstName).toBe("");
  expect(after.phone).toBe("");
  await Promise.all([page.close(), panel.close()]);
});

test("answering a question from the panel fills the page and is remembered", async () => {
  const { page, panel, form } = await filledWithPanel();
  const q = panel.getByRole("listitem").filter({ hasText: "How did you hear about this job?" });
  await q.getByRole("button", { name: "Answer" }).click();
  await q.getByRole("textbox").fill("A friend at Quillstone");
  await q.getByRole("button", { name: "Apply" }).click();
  await expect.poll(async () => (await form()).hearAbout).toBe("A friend at Quillstone");
  await expect
    .poll(() => api.state.answers.map((a) => a.question_key))
    .toContain("how did you hear about this job");
  await Promise.all([page.close(), panel.close()]);
});

test("Remember what I typed: answers given on the page are kept after a press", async () => {
  const { page, panel } = await filledWithPanel();
  await page.getByLabel("How did you hear about this job?").fill("Career fair");
  await panel.getByRole("button", { name: "Remember what I typed" }).click();
  const row = panel.getByLabel("Answer to How did you hear about this job?");
  await expect(row).toHaveValue("Career fair");
  await panel.getByRole("button", { name: "Save answers" }).click();
  await expect(panel.getByText(/Remembered 1/)).toBeVisible();
  expect(api.state.answers).toContainEqual(
    expect.objectContaining({ question_key: "how did you hear about this job", answer: "Career fair" }),
  );

  // ...and the next application fills it by itself.
  const next = await ext.context.newPage();
  await next.goto(lab.url("/lab/react-form/index.html"));
  await next.locator("#jec-autofill").click();
  await expect.poll(() => next.evaluate(() => window.__formData().hearAbout), { timeout: 15000 }).toBe("Career fair");
  expect(PERSON.email).toBeTruthy();
  await Promise.all([page.close(), panel.close(), next.close()]);
});
