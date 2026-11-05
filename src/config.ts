import { readFileSync } from "node:fs";
import { RuleRegistry } from "./registry";

export interface CustomRuleConfig {
  entity: string;
  pattern: string;
  flags?: string;
  priority?: number;
  group?: number;
  placeholder?: string;
  defaultEnabled?: boolean;
}

// Registers rules written as plain JSON, for example from a config file.
export function registerConfigRules(registry: RuleRegistry, configs: CustomRuleConfig[]): void {
  for (const c of configs) {
    if (!c || typeof c.entity !== "string" || typeof c.pattern !== "string") {
      throw new Error("Custom rule needs string 'entity' and 'pattern'");
    }
    registry.register({
      entity: c.entity,
      pattern: new RegExp(c.pattern, (c.flags ?? "").replace(/[gd]/g, "")),
      priority: c.priority ?? 50,
      group: c.group,
      placeholder: c.placeholder,
      defaultEnabled: c.defaultEnabled,
    });
  }
}

export function loadConfigFile(registry: RuleRegistry, path: string): void {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  registerConfigRules(registry, parsed.customRules ?? []);
}
