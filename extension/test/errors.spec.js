// Human-readable API errors + salary rounding — the two halves of the
// "$80,708.90 a year" 422 bug (raw pydantic JSON shown in the save button).
import { describe, it, expect } from "vitest";
import { friendlyApiError } from "../src/errors.js";
import { mergeJob } from "../src/extract/util.js";

describe("friendlyApiError", () => {
  it("turns a FastAPI validation error into field: message", () => {
    const body = JSON.stringify({
      detail: [
        {
          type: "int_from_float",
          loc: ["body", "salary_min"],
          msg: "Input should be a valid integer, got a number with a fractional part",
        },
      ],
    });
    expect(friendlyApiError(422, body)).toBe(
      "salary_min: Input should be a valid integer, got a number with a fractional part",
    );
  });

  it("passes through string details and survives garbage", () => {
    expect(friendlyApiError(409, '{"detail": "Job already saved"}')).toBe("Job already saved");
    expect(friendlyApiError(500, "<html>Internal Server Error</html>")).toBe(
      "<html>Internal Server Error</html>",
    );
    expect(friendlyApiError(502, "")).toBe("Request failed (502)");
  });
});

describe("mergeJob salary rounding", () => {
  it("rounds decimal salaries so no capture path can ship cents", () => {
    const out = mergeJob(
      [{ via: "jsonld", data: { title: "Web Developer", salary_min: 80708.9, salary_max: 101756.95 } }],
      "https://example.com/j/1",
    );
    expect(out.salary_min).toBe(80709);
    expect(out.salary_max).toBe(101757);
  });
});
