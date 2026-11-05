import { DeidentificationService } from "../../src/services/deidentification.service";

export const svc = new DeidentificationService();

export const run = (text: string, entities?: string[]) => svc.deidentify(text, { entities });

export const out = (text: string, entities?: string[]) => run(text, entities).deidentifiedText;
