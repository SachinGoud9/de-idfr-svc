import { Rule } from "../types";

const WORD = "(?:\\p{Lu}\\.|\\p{Lu}[\\p{L}'\\u2019-]*)";
const LABEL = "(?:[Pp]atient[ \\t]+[Nn]ame|[Ff]ull[ \\t]+[Nn]ame|[Cc]ustomer[ \\t]+[Nn]ame|[Nn]ame|NAME)";

// Only matches when there's a label: 1-4 capitalised words after "Name:".
// It's opt-in, so it isn't part of the default set.
export const nameRule: Rule = {
  entity: "NAME",
  priority: 50,
  pattern: new RegExp(`\\b${LABEL}[ \\t]*:[ \\t]*(${WORD}(?:[ \\t]+${WORD}){0,3})`, "gud"),
  group: 1,
  defaultEnabled: false,
};
