// Which profile answer a field asks for, and which fields must never be
// touched. PURE (no DOM): unit-tested in test/fill-resolve.spec.js.
//
// The words shown to people (labels, questions) are the stable signal on any
// site; the HTML `autocomplete` attribute, when a site sets it, is even better.

// ---- Never touch ----------------------------------------------------------

/** Protected self-identification: the user's to answer, always. */
export const SELF_ID =
  /ethnic|\brace\b|racial|gender|\bsex\b|hispanic|latin[ox]|veteran|disab(?:led|ilit)|sexual orientation|lgbtq?|transgender|\bpronouns?\b|voluntary (self[- ]?)?(identification|disclosure)|self[- ]identif/i;

/** Agreeing to terms or attesting to something: only the user can. */
export const CONSENT =
  /\bi (have read|agree|acknowledge|certify|attest|consent|understand|confirm that)|terms (of|and) |privacy (policy|notice)|consent|acknowledg|attest|certif(y|ication that)|by (checking|clicking|submitting)|e-?signature|electronic signature/i;

/** Essays: a person writes these (Write in the panel helps). */
export const ESSAY =
  /cover[\s_-]*letter|why (do you|are you|would you|this|our|we)|why .*(interest|join|work)|tell us (about|why)|describe (a|your|how)|what (makes|interests|excites|motivates)|anything else|additional (info|information|comments)|in your own words/i;

/** Page furniture that isn't an application question. */
export const NOISE =
  /cookie|newsletter|subscribe|marketing|notification|preference|personaliz|search jobs|keyword|job alert|captcha|password|promo(tion)? code|coupon/i;

/** Why a field is left alone, or null. Self-ID and consent come first. */
export function guardReason(question, kind) {
  const q = String(question || "");
  if (SELF_ID.test(q)) return "sensitive";
  if ((kind === "checkbox" || kind === "checkbox_list") && CONSENT.test(q)) return "consent";
  if (CONSENT.test(q) && /\bi (agree|certify|attest|acknowledge)|signature/i.test(q)) return "consent";
  if (NOISE.test(q)) return "noise";
  if (ESSAY.test(q) && (kind === "textarea" || kind === "editable" || kind === "text")) return "essay";
  return null;
}

// ---- Profile keys ---------------------------------------------------------

const AUTOCOMPLETE = {
  "given-name": "first_name",
  "additional-name": "middle_name",
  "family-name": "last_name",
  name: "full_name",
  nickname: "preferred_name",
  email: "email",
  tel: "phone",
  "tel-national": "phone",
  "street-address": "address_line1",
  "address-line1": "address_line1",
  "address-line2": "address_line2",
  "address-level2": "city",
  "address-level1": "state",
  "postal-code": "postal_code",
  country: "country",
  "country-name": "country",
  url: "portfolio_url",
};

// Ordered: FIRST match wins, so specific beats generic.
const RULES = [
  { key: "email_confirm", re: /(confirm|re-?enter|re-?type|verify|repeat)\s*(your\s*)?e-?mail/i },
  { key: "preferred_name", re: /preferred[\s_-]*(first[\s_-]*)?name|nick[\s_-]*name|goes by/i },
  { key: "middle_name", re: /middle[\s_-]*(name|initial)/i },
  { key: "first_name", re: /first[\s_-]*name|given[\s_-]*name|forename/i },
  { key: "last_name", re: /last[\s_-]*name|surname|family[\s_-]*name/i },
  { key: "full_name", re: /full[\s_-]*(legal[\s_-]*)?name|legal[\s_-]*name|your[\s_-]*name|^\W*name\W*$/i },
  { key: "email", re: /e-?mail/i },
  { key: "phone_type", re: /(phone|device)[\s_-]*(device[\s_-]*)?type|type of phone/i },
  { key: "phone_country", re: /country[\s_-]*(phone[\s_-]*)?code|phone.*country|dialing code/i },
  { key: "phone", re: /phone|mobile|telephone|cell/i },
  { key: "linkedin_url", re: /linked[\s_-]*in/i },
  { key: "github_url", re: /git[\s_-]*hub/i },
  { key: "portfolio_url", re: /portfolio|personal[\s_-]*(web)?site|website|^url$|other (url|link)/i },
  // One combined "location" field (Greenhouse, Lever, Ashby) beats the
  // granular address keys.
  { key: "location", re: /^location\b|current location|where are you (located|based)|city,? state|location \(city\)/i },
  { key: "address_line2", re: /address[\s_-]*line[\s_-]*2|apartment|\bapt\b|\bunit\b|suite/i },
  { key: "address_line1", re: /address[\s_-]*line[\s_-]*1|street[\s_-]*address|^street|^address\b|^address line$|home address/i },
  { key: "city", re: /\bcity\b|\btown\b/i },
  { key: "postal_code", re: /postal|\bzip\b|zip[\s_-]*code|post[\s_-]*code/i },
  { key: "country", re: /\bcountry\b/i },
  { key: "state", re: /\bstate\b|province|\bregion\b/i },
  {
    key: "authorized_to_work",
    re: /authori[sz]ed[\s\S]*(work|employ)|work[\s_-]*authori[sz]ation|legally[\s\S]*(work|employ)|eligib[\s\S]*(work|employ)|right to work/i,
  },
  { key: "requires_sponsorship", re: /sponsor/i },
  { key: "willing_to_relocate", re: /relocat/i },
  { key: "desired_salary", re: /desired[\s_-]*(salary|pay|compensation)|salary[\s_-]*(expectation|requirement)|expected[\s_-]*(salary|pay|compensation)|compensation[\s_-]*expect|^salary$/i },
  { key: "notice_period", re: /notice[\s_-]*period|(earliest|available)[\s_-]*start|start[\s_-]*date|when can you start|availability to start/i },
  { key: "today_date", re: /today['’]?s?[\s_-]*date|current[\s_-]*date|date[\s_-]*signed|signature[\s_-]*date|^date$/i },
];

/** Profile keys answered Yes/No. */
export const BOOL_KEYS = new Set(["authorized_to_work", "requires_sponsorship", "willing_to_relocate"]);

/**
 * The profile key a field asks for, or null.
 * @param {{question: string, hints: {autocomplete?: string, type?: string, name?: string, id?: string}}} field
 */
export function profileKeyFor(field) {
  const ac = String(field.hints?.autocomplete || "").toLowerCase();
  for (const token of ac.split(/\s+/)) if (AUTOCOMPLETE[token]) return AUTOCOMPLETE[token];
  if (field.hints?.type === "email") {
    return /(confirm|re-?enter|verify|repeat)/i.test(field.question) ? "email_confirm" : "email";
  }
  if (field.hints?.type === "tel") return "phone";
  const text = [field.question, field.hints?.name, field.hints?.id].filter(Boolean).join(" ");
  for (const { key, re } of RULES) if (re.test(field.question) || (!field.question && re.test(text))) return key;
  return null;
}

// ---- Values ---------------------------------------------------------------

const US_STATES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

function stateForms(v) {
  if (!v) return [];
  const s = String(v).trim();
  const code = s.length === 2 ? s.toUpperCase() : Object.keys(US_STATES).find((k) => US_STATES[k].toLowerCase() === s.toLowerCase());
  return code && US_STATES[code] ? [US_STATES[code], code] : [s];
}

function countryForms(v) {
  if (!v) return [];
  const s = String(v).trim();
  if (/^(us|usa|u\.s\.a?\.?|united states( of america)?|america)$/i.test(s)) {
    return ["United States", "United States of America", "USA", "US"];
  }
  return [s];
}

const yn = (v) => (v === true ? "Yes" : v === false ? "No" : null);

/**
 * Every profile key's answer(s): the first is what's typed into a text box;
 * the rest are other ways a dropdown may word it ("OR" / "Oregon").
 * @returns {Record<string, string[]>}
 */
export function profileValues(profile, email, today = new Date()) {
  const p = profile || {};
  const list = (...vals) => vals.filter((x) => x != null && String(x).trim() !== "").map(String);
  const city = p.city || "";
  const stateFull = stateForms(p.state)[0] || "";
  return {
    first_name: list(p.first_name),
    preferred_name: list(p.first_name),
    last_name: list(p.last_name),
    middle_name: [],
    full_name: list([p.first_name, p.last_name].filter(Boolean).join(" ")),
    email: list(email),
    email_confirm: list(email),
    phone: list(p.phone),
    phone_type: list(p.phone ? "Mobile" : null, p.phone ? "Cell" : null),
    phone_country: list(...(/^(us|usa|united states)/i.test(p.country || "United States") && p.phone ? ["United States (+1)", "+1", "United States"] : [])),
    address_line1: list(p.address_line1),
    address_line2: list(p.address_line2),
    city: list(city),
    state: stateForms(p.state),
    postal_code: list(p.postal_code),
    country: countryForms(p.country),
    location: list(
      [city, p.state].filter(Boolean).join(", "),
      [city, stateFull].filter(Boolean).join(", "),
      city,
    ),
    linkedin_url: list(p.linkedin_url),
    github_url: list(p.github_url),
    portfolio_url: list(p.portfolio_url),
    authorized_to_work: list(yn(p.authorized_to_work)),
    requires_sponsorship: list(yn(p.requires_sponsorship)),
    willing_to_relocate: list(yn(p.willing_to_relocate)),
    desired_salary: list(p.desired_salary),
    notice_period: list(p.notice_period),
    today_date: list(today.toISOString().slice(0, 10)),
  };
}
