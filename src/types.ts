export interface RuleContext {
  text: string;
  start: number;
  end: number;
}

// A detection rule. To add a new one, just register it, nothing else needs to change.
export interface Rule {
  entity: string;
  pattern: RegExp;
  // When two rules match the same text, the higher number wins.
  priority: number;
  // If set, only this capture group gets replaced. Handy for rules like "DOB: <date>"
  // where the label should stay.
  group?: number;
  // Optional extra check (checksum, range, etc.) to throw out false matches.
  validate?: (value: string, ctx: RuleContext) => boolean;
  // Text to put in place of the match. Defaults to `[ENTITY]`.
  placeholder?: string;
  // Set to false to only apply this entity when someone asks for it. Defaults to true.
  defaultEnabled?: boolean;
}

export interface Span {
  start: number;
  end: number;
  entity: string;
  priority: number;
  placeholder: string;
}

export interface DeidentifyResult {
  deidentifiedText: string;
  entitiesDetected: Record<string, number>;
}
