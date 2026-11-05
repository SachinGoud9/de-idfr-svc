import { Rule } from "../types";

// Skips numbers that can't be real SSNs: area 000, 666 or 900-999, group 00, serial 0000.
export const ssnRule: Rule = {
  entity: "SSN",
  priority: 90,
  pattern: /(?<![\d-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\d-])/g,
};
