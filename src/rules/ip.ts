import { Rule } from "../types";

const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";

export const ipRule: Rule = {
  entity: "IP_ADDRESS",
  priority: 70,
  pattern: new RegExp(`(?<![\\d.])(?:${OCTET}\\.){3}${OCTET}(?!\\d|\\.\\d)`, "g"),
};
