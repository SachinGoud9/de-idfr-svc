import { Rule } from "../types";

export function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

// Checks the starting digits and length against the major card networks.
export function validIssuer(d: string): boolean {
  const n = (len: number) => Number(d.slice(0, len));
  const L = d.length;
  if (d[0] === "4") return L === 13 || L === 16 || L === 19; // Visa
  if ((n(2) >= 51 && n(2) <= 55) || (n(4) >= 2221 && n(4) <= 2720)) return L === 16; // Mastercard
  if (n(2) === 34 || n(2) === 37) return L === 15; // Amex
  if (n(4) === 6011 || n(2) === 65 || (n(3) >= 644 && n(3) <= 649)) return L >= 16 && L <= 19; // Discover
  if (n(4) >= 3528 && n(4) <= 3589) return L >= 16 && L <= 19; // JCB
  if ((n(3) >= 300 && n(3) <= 305) || n(2) === 36 || n(2) === 38) return L >= 14 && L <= 19; // Diners
  return false;
}

// Only three shapes: plain digits, 4-4-4-n with the same separator throughout, or Amex 4-6-5.
// Matching exact shapes (not just "digits and spaces") keeps two numbers next to each
// other from getting merged into one match.
export const creditCardRule: Rule = {
  entity: "CREDIT_CARD",
  priority: 100,
  pattern: /(?<![\d-])(?:\d{13,19}|\d{4}([ -])\d{4}\1\d{4}\1\d{1,7}|\d{4}([ -])\d{6}\2\d{5})(?![\d-])/g,
  validate: (value) => {
    const digits = value.replace(/[ -]/g, "");
    return digits.length >= 13 && digits.length <= 19 && validIssuer(digits) && luhn(digits);
  },
};
