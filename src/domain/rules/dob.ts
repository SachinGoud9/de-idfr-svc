import { Rule } from "../types";

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?";
const DATE = [
  "\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}", // 1990-05-12
  "\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{4}", // 05/12/1990 or 12.05.1990
  `${MONTH}[ \\t]+\\d{1,2}(?:st|nd|rd|th)?,?[ \\t]+\\d{4}`, // May 12, 1990
  `\\d{1,2}(?:st|nd|rd|th)?[ \\t]+${MONTH},?[ \\t]+\\d{4}`, // 12 May 1990
].join("|");
const LABEL = "(?:DOB|D\\.O\\.B|Date[ \\t]+of[ \\t]+Birth|Birth[ \\t]*date|Birthday|Born(?:[ \\t]+on)?)";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function validYMD(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > new Date().getFullYear()) return false;
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate(); // last day of the month, handles leap years
}

export function validDate(s: string): boolean {
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return validYMD(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return validYMD(+m[3], +m[1], +m[2]) || validYMD(+m[3], +m[2], +m[1]); // month-first or day-first, either is fine
  m = s.match(/^([A-Za-z]+)\.?[ \t]+(\d{1,2})(?:st|nd|rd|th)?,?[ \t]+(\d{4})$/);
  if (m) return validYMD(+m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]);
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[ \t]+([A-Za-z]+)\.?,?[ \t]+(\d{4})$/);
  if (m) return validYMD(+m[3], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1]);
  return false;
}

// We only replace the date (group 1), so the label stays: "DOB: [DATE_OF_BIRTH]".
export const dobRule: Rule = {
  entity: "DATE_OF_BIRTH",
  priority: 60,
  pattern: new RegExp(`\\b${LABEL}\\.?[ \\t]*(?:[:=-]|is)?[ \\t]*(${DATE})(?!\\d)`, "gid"),
  group: 1,
  validate: validDate,
};
