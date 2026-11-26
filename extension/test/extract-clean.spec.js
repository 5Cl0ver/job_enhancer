// Spec 022 part A: Job Catcher saves the whole job, correctly. Each case is one
// seen in the owner's saved jobs (2026-11-24): LinkedIn descriptions ending in
// "… more", Indeed titles saved as the tab's name, "ZipRecruiter" saved as a
// company, a job titled with its company's name, "careers-acmeglobal".
import { describe, it, expect } from "vitest";
import { Window } from "happy-dom";
import { cleanDescription, cleanTitle, isBoardName, mergeJob, tidyJob } from "../src/extract/util.js";
import { expandMore } from "../src/extract/expand.js";
import { extractJob } from "../src/extract/index.js";

function docOf(html, url = "https://example.com/") {
  const window = new Window({ url });
  window.document.write(html);
  return window.document;
}

describe("descriptions never keep the expand button's words", () => {
  it("drops LinkedIn's '… more' after the last sentence", () => {
    expect(cleanDescription("We comply with all E-Verify regulations.… more")).toBe(
      "We comply with all E-Verify regulations.",
    );
    expect(cleanDescription("Pay: 80,000 - 90,000 CAD... more")).toBe("Pay: 80,000 - 90,000 CAD");
  });

  it("drops a last line that is only a button", () => {
    for (const button of ["Show more", "See more", "Read more", "Show less", "…more", "See more details"]) {
      expect(cleanDescription(`Line one.\nLine two.\n${button}`)).toBe("Line one.\nLine two.");
    }
  });

  it("keeps real words that only look close", () => {
    expect(cleanDescription("Benefits, perks and more")).toBe("Benefits, perks and more");
    expect(cleanDescription("Click here to learn more")).toBe("Click here to learn more");
  });

  it("mergeJob cleans the description it picks", () => {
    const job = mergeJob([{ via: "site", data: { title: "IT Engineer", description: "Do the work.\n… more" } }], "u");
    expect(job.description).toBe("Do the work.");
  });
});

describe("titles lose the site's name and the tab's place", () => {
  it("cuts Indeed's tab title down to the job", () => {
    expect(cleanTitle("Systems Engineer (Unified Communications) - Clackamas, OR 97015 - Indeed.com")).toBe(
      "Systems Engineer (Unified Communications)",
    );
    expect(cleanTitle("Systems Engineer - Tier II - Clackamas, OR 97015 - Indeed.com")).toBe(
      "Systems Engineer - Tier II",
    );
    expect(cleanTitle("Help Desk Technician - Remote - Indeed.com")).toBe("Help Desk Technician");
    expect(cleanTitle("Network Admin | LinkedIn")).toBe("Network Admin");
    expect(cleanTitle("Systems Engineer - ZipRecruiter")).toBe("Systems Engineer");
  });

  it("leaves a real title alone, place and all, when no board name is there", () => {
    expect(cleanTitle("IT Systems Engineer (On-Site - Washington/Oregon State)")).toBe(
      "IT Systems Engineer (On-Site - Washington/Oregon State)",
    );
    expect(cleanTitle("Field Tech - Portland, OR")).toBe("Field Tech - Portland, OR");
  });
});

describe("companies are never a board, and a title is never just the company", () => {
  it("knows the boards' names", () => {
    expect(isBoardName("ZipRecruiter")).toBe(true);
    expect(isBoardName("Indeed.com")).toBe(true);
    expect(isBoardName("Acme Corp")).toBe(false);
  });

  it("skips a board's name for the next source's company", () => {
    const job = mergeJob(
      [
        { via: "site", data: { title: "Systems Engineer", company: "ZipRecruiter" } },
        { via: "jsonld", data: { company: "Industrial eNet" } },
      ],
      "u",
    );
    expect(job.company).toBe("Industrial eNet");
  });

  it("trusts a posting's own data: LinkedIn and Indeed hire people too", () => {
    const job = mergeJob([{ via: "jsonld", data: { title: "Senior SWE", company: "LinkedIn" } }], "u");
    expect(job.company).toBe("LinkedIn");
    expect(mergeJob([{ via: "site", data: { title: "SWE", company: "Google" } }], "u").company).toBe("Google");
  });

  it("drops 'careers-' from a company read off the page", () => {
    expect(mergeJob([{ via: "site", data: { title: "IT Support", company: "careers-acmeglobal" } }], "u").company).toBe(
      "acmeglobal",
    );
  });

  it("leaves the company blank rather than a board's name", () => {
    const job = mergeJob([{ via: "site", data: { title: "Systems Engineer", company: "ZipRecruiter" } }], "u");
    expect(job.company).toBe("");
  });

  it("prefers a real title over one that is the company's name", () => {
    const job = mergeJob(
      [
        { via: "site", data: { title: "Cedar Public Utilities", company: "Cedar Public Utilities" } },
        { via: "generic", data: { title: "Network Engineer II" } },
      ],
      "u",
    );
    expect(job.title).toBe("Network Engineer II");
    expect(job._via).toBe("generic");
  });

  it("keeps the company's name as the title when nothing else is offered", () => {
    const job = mergeJob([{ via: "site", data: { title: "Acme", company: "Acme" } }], "u");
    expect(job.title).toBe("Acme");
  });

  it("tidyJob fixes the panel's reads the same way", () => {
    const job = tidyJob({
      title: "IT Support Engineer - Indeed.com",
      company: "careers-acmeglobal",
      description: "Text.\nShow more",
    });
    expect(job).toMatchObject({ title: "IT Support Engineer", company: "acmeglobal", description: "Text." });
    expect(tidyJob({ title: "X", company: "LinkedIn", description: "" }).company).toBe("");
  });

  it("an Indeed page whose only title is og:title saves just the job", () => {
    const doc = docOf(
      `<html><head><meta property="og:title" content="IT Supervisor - Hillsboro, OR 97124 - Indeed.com"></head>
       <body><p>${"Run the help desk. ".repeat(20)}</p></body></html>`,
      "https://www.indeed.com/viewjob?jk=91ab8ba4cf17e534",
    );
    expect(extractJob(doc, "https://www.indeed.com/viewjob?jk=91ab8ba4cf17e534").title).toBe("IT Supervisor");
  });
});

describe("a Save opens a description hidden behind 'See more'", () => {
  const long = "Responsibilities include many things. ".repeat(12);

  it("presses the description's own button", () => {
    const doc = docOf(`<div class="jobs-description__content"><p>${long}</p>
      <button aria-label="Click to see more description">See more</button></div>`);
    let pressed = 0;
    doc.querySelector("button").addEventListener("click", () => pressed++);
    expect(expandMore(doc)).toBe(1);
    expect(pressed).toBe(1);
  });

  it("presses LinkedIn's button in the description's own footer", () => {
    const doc = docOf(`<body><header><nav>Jobs</nav></header><div class="jobs-description__container">
      <div class="jobs-description__content"><p>${long}</p></div>
      <footer class="jobs-description__footer"><button class="jobs-description__footer-button"
        aria-label="Click to see more description" aria-haspopup="false">See more</button></footer></div></body>`);
    expect(expandMore(doc)).toBe(1);
  });

  it("never presses one in the page's own header or footer", () => {
    const doc = docOf(`<body><div class="job-description"><p>${long}</p></div>
      <footer><p>${long}</p><button aria-expanded="false">Show more</button></footer></body>`);
    expect(expandMore(doc)).toBe(0);
  });

  it("presses a closed 'Read more' toggle beside a long text", () => {
    const doc = docOf(`<section><p>${long}</p><button aria-expanded="false">Read more</button></section>`);
    expect(expandMore(doc)).toBe(1);
  });

  it("leaves open toggles, real links and other lists alone", () => {
    const doc = docOf(`<div class="job-description"><p>${long}</p>
        <button aria-expanded="true">Show more</button>
        <a href="/jobs/123">See more</a></div>
      <div class="people"><p>${long}</p><button>Show more</button></div>`);
    expect(expandMore(doc)).toBe(0);
  });

  it("never presses menus, 'Show all', navigation or a form's submit button", () => {
    const doc = docOf(`<nav><p>${long}</p><button aria-expanded="false">Show more</button></nav>
      <div class="job-description"><p>${long}</p>
        <button aria-expanded="false" aria-haspopup="menu">See more</button>
        <button>Show all</button></div>
      <form><div class="job-description"><p>${long}</p><button>Show more</button></div></form>`);
    let submitted = 0;
    doc.querySelector("form").addEventListener("submit", (e) => {
      submitted++;
      e.preventDefault();
    });
    expect(expandMore(doc)).toBe(0);
    expect(submitted).toBe(0);
  });

  it("presses a form's plain button (type=button) inside the description", () => {
    const doc = docOf(`<form><div class="job-description"><p>${long}</p><button type="button">Show more</button></div></form>`);
    expect(expandMore(doc)).toBe(1);
  });

  it("presses only one, the visible one, so a twin toggle doesn't close it again", () => {
    const doc = docOf(`<div class="job-description"><p>${long}</p>
      <button class="mobile" hidden>Read more</button>
      <button class="desktop">Read more</button>
      <button class="footer">See more</button></div>`);
    const pressed = [];
    for (const b of doc.querySelectorAll("button")) b.addEventListener("click", () => pressed.push(b.className));
    expect(expandMore(doc)).toBe(1);
    expect(pressed).toEqual(["desktop"]);
  });

  it("presses nothing while the user has text highlighted", () => {
    const doc = docOf(`<div class="job-description"><p id="t">${long}</p><button>Read more</button></div>`);
    const range = doc.createRange();
    range.selectNodeContents(doc.getElementById("t"));
    doc.defaultView.getSelection().addRange(range);
    expect(expandMore(doc)).toBe(0);
  });
});
