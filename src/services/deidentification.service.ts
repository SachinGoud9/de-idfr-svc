import { detect } from "../domain/detector";
import { replaceSpans } from "../domain/replacer";
import { RuleRegistry } from "../domain/registry";
import { createDefaultRegistry } from "../domain/rules";
import { DeidentifyResult } from "../domain/types";
import { ValidationError } from "../errors";

export const MAX_TEXT_LENGTH = 1_000_000;
export const MAX_BATCH_SIZE = 1000;

export interface DeidentifyOptions {
  // Which entities to mask. If left out we use the defaults (all core ones, not NAME).
  entities?: unknown;
}

export class DeidentificationService {
  constructor(readonly registry: RuleRegistry = createDefaultRegistry()) {}

  resolveEntities(entities: unknown): string[] {
    if (entities === undefined || entities === null) return this.registry.defaultEntities();
    if (!Array.isArray(entities) || entities.length === 0) {
      throw new ValidationError("'entities' must be a non-empty array of entity names");
    }
    const names = entities.map((e) => {
      if (typeof e !== "string") throw new ValidationError("'entities' must contain only strings");
      return e.trim().toUpperCase();
    });
    const unknown = names.filter((n) => !this.registry.has(n));
    if (unknown.length) {
      throw new ValidationError(
        `Unknown entities: ${unknown.join(", ")}. Supported: ${this.registry.entities().join(", ")}`
      );
    }
    return [...new Set(names)];
  }

  deidentify(text: unknown, options: DeidentifyOptions = {}): DeidentifyResult {
    if (typeof text !== "string") throw new ValidationError("'text' is required and must be a string");
    if (text.length > MAX_TEXT_LENGTH) {
      throw new ValidationError(`'text' exceeds the maximum length of ${MAX_TEXT_LENGTH} characters`);
    }
    const entities = this.resolveEntities(options.entities);
    return this.run(text, entities);
  }

  deidentifyBatch(records: unknown, options: DeidentifyOptions = {}) {
    if (!Array.isArray(records) || records.length === 0) {
      throw new ValidationError("'records' must be a non-empty array");
    }
    if (records.length > MAX_BATCH_SIZE) {
      throw new ValidationError(`'records' exceeds the maximum batch size of ${MAX_BATCH_SIZE}`);
    }
    const entities = this.resolveEntities(options.entities);
    return records.map((rec, i) => {
      const text = typeof rec === "string" ? rec : rec?.text;
      if (typeof text !== "string") throw new ValidationError(`records[${i}].text must be a string`);
      if (text.length > MAX_TEXT_LENGTH) throw new ValidationError(`records[${i}].text is too long`);
      const id = typeof rec === "object" && rec !== null ? rec.id : undefined;
      return { ...(id !== undefined ? { id } : {}), ...this.run(text, entities) };
    });
  }

  private run(text: string, entities: string[]): DeidentifyResult {
    const spans = detect(text, this.registry.rulesFor(entities));
    const entitiesDetected: Record<string, number> = {};
    for (const s of spans) entitiesDetected[s.entity] = (entitiesDetected[s.entity] ?? 0) + 1;
    return { deidentifiedText: replaceSpans(text, spans), entitiesDetected };
  }
}
