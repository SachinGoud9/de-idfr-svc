import { Rule } from "./types";

export class RuleRegistry {
  private rules: Rule[] = [];

  register(rule: Rule): this {
    const entity = rule.entity.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(entity)) {
      throw new Error(`Invalid entity name "${rule.entity}" (use A-Z, 0-9, _)`);
    }
    // The detector needs the g flag, and d too so we can find capture group positions.
    let flags = rule.pattern.flags;
    for (const f of ["g", "d"]) if (!flags.includes(f)) flags += f;
    this.rules.push({ ...rule, entity, pattern: new RegExp(rule.pattern.source, flags) });
    return this;
  }

  // Every entity name, in the order they were registered.
  entities(): string[] {
    return [...new Set(this.rules.map((r) => r.entity))];
  }

  // What we use when the caller doesn't send an `entities` list.
  defaultEntities(): string[] {
    return this.entities().filter((e) =>
      this.rules.some((r) => r.entity === e && r.defaultEnabled !== false)
    );
  }

  has(entity: string): boolean {
    return this.rules.some((r) => r.entity === entity);
  }

  rulesFor(entities: string[]): Rule[] {
    const set = new Set(entities);
    return this.rules.filter((r) => set.has(r.entity));
  }
}
