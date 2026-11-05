import { Rule } from "../types";

const digitsOf = (s: string) => s.replace(/\D/g, "");

// US/Canada rule: the area code and the exchange both have to start with 2-9.
function validNanp(value: string): boolean {
  let d = digitsOf(value);
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  return d.length === 10 && /[2-9]/.test(d[0]) && /[2-9]/.test(d[3]);
}

// 1) International numbers that start with "+", like +44 20 7946 0958 or +1-415-555-0134
export const phoneIntlRule: Rule = {
  entity: "PHONE",
  priority: 40,
  pattern: /(?<![\w+])\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}(?!\d)/g,
  validate: (v) => {
    const n = digitsOf(v).length;
    return n >= 8 && n <= 15; // no phone number is longer than 15 digits (E.164)
  },
};

// 1b) Same thing written with the "00" exit prefix used outside North America: 0044 20 7946 0958.
// Separators are required between every group so plain digit strings like 0012345678 stay alone.
export const phoneExitPrefixRule: Rule = {
  entity: "PHONE",
  priority: 40,
  pattern: /(?<![\w+])00\d{1,3}[\s.-]\(?\d{1,4}\)?(?:[\s.-]\d{2,4}){2,4}(?!\d)/g,
  validate: (v) => {
    const n = digitsOf(v).length - 2; // don't count the leading 00
    return n >= 8 && n <= 15;
  },
};

// 2) US/Canada numbers with separators: (415) 555-0134, 415-555-0134, 415.555.0134, 1 415 555 0134
export const phoneUsRule: Rule = {
  entity: "PHONE",
  priority: 40,
  pattern: /(?<![\w.+-])(?:1[-.\s])?(?:\(\d{3}\)\s?|\d{3}[-.\s])\d{3}[-.\s]\d{4}(?![\w-]|\.\d)/g,
  validate: validNanp,
};

// 2b) Indian mobile numbers written as 5+5 digits: 90100 97404, 98765-43210.
// Mobile numbers there always start with 6-9, which keeps this from matching things like ZIP+ID pairs.
export const phoneIndiaRule: Rule = {
  entity: "PHONE",
  priority: 40,
  pattern: /(?<![\w.+-])[6-9]\d{4}[\s-]\d{5}(?![\w-]|\.\d)/g,
};

// 3) Plain 10 digits, but only right after a label like "Phone: 4155550134"
export const phoneLabeledRule: Rule = {
  entity: "PHONE",
  priority: 40,
  pattern:
    /\b(?:phone|tel|telephone|mobile|cell|fax)(?:[ \t]+(?:number|no\.?|#))?[ \t]*[:#]?[ \t]*(\d{10})(?!\d)/dgi,
  group: 1,
  validate: validNanp,
};
