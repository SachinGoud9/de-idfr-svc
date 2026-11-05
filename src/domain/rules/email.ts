import { Rule } from "../types";

// Local part is letters, digits and . _ % + -, plus apostrophes between those characters
// (o'brien@example.com). We deliberately do NOT accept the other RFC 5322 specials like
// ! = / ? since they would swallow surrounding text: "email=a@b.com" must stay "email=[EMAIL]".
export const emailRule: Rule = {
  entity: "EMAIL",
  priority: 80,
  pattern:
    /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+(?:'[A-Za-z0-9._%+-]+)*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9_-])/g,
};
