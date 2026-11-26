// Spec 036, in real Chromium on the Workday lab copies, served at an invented
// Workday address: "How Did You Hear About Us?" (Workday's search prompt)
// gets a real pill, never typed text that vanishes; on a revisited My
// Information step the phone never goes in Phone Extension and what the user
// emptied stays empty; sponsorship questions get the profile's answer.
// Nothing is ever submitted by Job Catcher. Invented company and applicant.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startFakeApi, PERSON } from "./support/fake-api.js";
import { ROOT, launchExtension } from "./support/launch.js";

const JOB = "https://northwind.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/Applications-Developer-II_JR-1001";
const PAGES = {
  hear: [`${JOB}/apply/applyManually`, "workday-hear-about.html"],
  revisit: [`${JOB}/apply/useMyLastApplication`, "workday-info-revisit.html"],
  sponsor: [`${JOB}/apply/autofillWithResume`, "workday-sponsorship.html"],
};

let api;
let ext;

test.beforeAll(async () => {
  api = await startFakeApi();
  ext = await launchExtension({ apiUrl: api.url });
  for (const [url, file] of Object.values(PAGES)) {
    const html = readFileSync(join(ROOT, "test", "lab", file), "utf8");
    await ext.context.route(url, (r) => r.fulfill({ status: 200, contentType: "text/html", body: html }));
  }
});

test.afterAll(async () => {
  await ext?.close();
  await api?.close();
});

test.beforeEach(async () => {
  api.reset();
  api.clearCalls();
  api.state.answers = [];
  api.state.taught = [];
  api.state.profile = { ...PERSON.profile };
  api.state.bundleVersion++;
  await ext.worker.evaluate(async () => {
    await chrome.storage.local.remove(["je_autofill", "je_saved_cache", "je_not_this", "je_page_job"]);
    await chrome.storage.sync.set({ je_super: false }); // press-only
  });
});

const form = (page) => page.evaluate(() => window.__formData());

/** The fill's report on a tab: what Job Catcher filled, and label → why for the rest. */
async function fillReport(page) {
  const s = await ext.bg({ type: "getFillSession", tabId: await ext.tabIdOf(page) });
  const frames = Object.values(s.frames || {});
  return {
    filled: Object.fromEntries(frames.flatMap((f) => (f.entries || []).map((e) => [e.label, e.value]))),
    need: Object.fromEntries(frames.flatMap((f) => (f.need_you || []).map((n) => [n.label, n.reason]))),
  };
}

test("How Did You Hear About Us?: a remembered answer becomes a real pill, and the report says so", async () => {
  api.state.answers = [{ question_key: "how did you hear about us", question_text: "How Did You Hear About Us?", answer: "LinkedIn" }];
  api.state.bundleVersion++;
  const page = await ext.context.newPage();
  await page.goto(PAGES.hear[0]);
  expect((await ext.autofill(page)).ok).toBe(true);
  await expect.poll(async () => (await form(page)).source, { timeout: 15000 }).toEqual(["LinkedIn"]);
  await expect(page.locator('[data-automation-id="selectedItem"]')).toHaveText(["LinkedIn"]);
  // Leaving the box empties its search text: the pill stays, the answer stays.
  await page.locator("#addressSection_city").click();
  await page.waitForTimeout(300);
  expect((await form(page)).source).toEqual(["LinkedIn"]);
  const r = await fillReport(page);
  expect(r.filled["How Did You Hear About Us?"]).toBe("LinkedIn");
  expect(r.need["How Did You Hear About Us?"]).toBeUndefined();
  await page.close();
});

test("How Did You Hear About Us?: an answer the site doesn't offer is never reported filled", async () => {
  api.state.answers = [{ question_key: "how did you hear about us", question_text: "How Did You Hear About Us?", answer: "Radio advert" }];
  api.state.bundleVersion++;
  const page = await ext.context.newPage();
  await page.goto(PAGES.hear[0]);
  expect((await ext.autofill(page)).ok).toBe(true);
  await expect.poll(async () => (await fillReport(page)).need["How Did You Hear About Us?"], { timeout: 15000 }).toBe("no_option");
  expect((await form(page)).source).toEqual([]);
  await expect(page.locator("#source--source")).toHaveValue("");
  expect((await fillReport(page)).filled["How Did You Hear About Us?"]).toBeUndefined();
  await page.close();
});

test("My Information revisited: the extension never gets the phone, and what the user emptied stays empty", async () => {
  // An old mistake remembered: the whole number as the extension's answer.
  api.state.answers = [{ question_key: "phone extension", question_text: "Phone Extension", answer: "555-010-4477" }];
  api.state.bundleVersion++;
  const page = await ext.context.newPage();
  await page.goto(PAGES.revisit[0]);
  expect((await ext.autofill(page)).ok).toBe(true);
  await expect(page.locator("#phoneNumber--phoneNumber")).toHaveValue(PERSON.profile.phone);
  await expect(page.locator("#addressSection_city")).toHaveValue(PERSON.profile.city);
  // A moment later (a person never edits mid-fill), the user empties the
  // extension (the page had the whole number in it) and City.
  await page.waitForTimeout(1500);
  await page.locator("#phoneNumber--extension").fill("");
  await page.locator("#addressSection_city").fill("");
  await page.locator("#addressSection_addressLine1").click(); // leave the box
  await page.waitForTimeout(300);
  // Save and Continue, then Back: My Information drawn again, new boxes.
  await page.locator("#next").click();
  await expect(page.locator("#title")).toHaveText("My Experience");
  await page.locator("#back").click();
  await expect(page.locator("#title")).toHaveText("My Information");
  expect((await ext.autofill(page)).ok).toBe(true);
  await page.waitForTimeout(500);
  await expect(page.locator("#phoneNumber--extension")).toHaveValue("");
  await expect(page.locator("#addressSection_city")).toHaveValue("");
  await expect(page.locator("#phoneNumber--phoneNumber")).toHaveValue(PERSON.profile.phone);
  const data = await form(page);
  expect(data["phoneNumber--extension"]).toBe("");
  expect(data.addressSection_city).toBe("");
  await page.close();
});

test("sponsorship, however it's worded: the profile's answer; two questions in one are left", async () => {
  const page = await ext.context.newPage();
  await page.goto(PAGES.sponsor[0]);
  expect((await ext.autofill(page)).ok).toBe(true);
  await expect.poll(async () => (await form(page))["sponsor-legally"], { timeout: 15000 }).toBe("No");
  const data = await form(page);
  expect(data).toMatchObject({
    "sponsor-authorization": "No",
    "sponsor-eligible": "No, I will not require sponsorship",
    "without-sponsorship": "Yes",
    authorized: "Yes",
  });
  expect(data.both).toBeUndefined();
  const r = await fillReport(page);
  expect(r.need["Are you legally authorized to work in the US, and will you require sponsorship?"]).toBe("unknown");
  await page.close();
});
