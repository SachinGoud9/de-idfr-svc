import { RuleRegistry } from "../registry";
import { Rule } from "../types";
import { emailRule } from "./email";
import { ssnRule } from "./ssn";
import { ipRule } from "./ip";
import { creditCardRule } from "./creditCard";
import { dobRule } from "./dob";
import { phoneIntlRule, phoneExitPrefixRule, phoneUsRule, phoneIndiaRule, phoneLabeledRule } from "./phone";
import { nameRule } from "./name";

export const builtinRules: Rule[] = [
  emailRule,
  phoneIntlRule,
  phoneExitPrefixRule,
  phoneUsRule,
  phoneIndiaRule,
  phoneLabeledRule,
  ssnRule,
  dobRule,
  creditCardRule,
  ipRule,
  nameRule,
];

export function createDefaultRegistry(): RuleRegistry {
  const r = new RuleRegistry();
  builtinRules.forEach((rule) => r.register(rule));
  return r;
}
