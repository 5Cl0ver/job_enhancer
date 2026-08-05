/**
 * Fixed option lists for the Application Profile form — dropdowns for what
 * real application forms treat as dropdowns (states, countries, notice
 * period), so users pick instead of type.
 */

export const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "District of Columbia", "Florida", "Georgia",
  "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky",
  "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
  "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota",
  "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island",
  "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont",
  "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
] as const;

// ISO-3166 alpha-2 codes; display names come from the browser's own
// Intl.DisplayNames — full country list with zero dependencies.
const COUNTRY_CODES =
  ("AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN " +
    "BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO " +
    "EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU " +
    "IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI " +
    "LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ " +
    "NI NE NG MK NO OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST " +
    "SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TW TJ TZ TH TL TG " +
    "TO TT TN TR TM TV UG UA AE GB US UY UZ VU VE VN YE ZM ZW").split(" ");

// The likeliest picks, pinned above the alphabetical rest (standard forms UX).
const PINNED = ["US", "CA", "GB", "MX", "IN"];

const _names = new Intl.DisplayNames(["en"], { type: "region" });

export const COUNTRIES: string[] = (() => {
  const name = (code: string) => _names.of(code) ?? code;
  const rest = COUNTRY_CODES.filter((c) => !PINNED.includes(c))
    .map(name)
    .sort((a, b) => a.localeCompare(b));
  return [...PINNED.map(name), ...rest];
})();

export const NOTICE_PERIODS = [
  "Immediately",
  "1 week",
  "2 weeks",
  "3 weeks",
  "1 month",
  "2 months",
  "3+ months",
] as const;
