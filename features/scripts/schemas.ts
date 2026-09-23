/**
 * Strict JSON schemas for the AI script parse's model calls (structured
 * outputs). Pure module — no server imports — so the shapes are unit-testable.
 */
// ── Structured outputs ──────────────────────────────────────────────────────
// Every model call declares a strict JSON schema (`output_config.format`), so
// the reply is grammar-constrained valid JSON: quotes inside a verbatim anchor
// or an OCR'd character name get escaped by the API instead of breaking the
// parse. (The first live text-mode run on an OCR'd script failed twice on
// exactly that.) The prompts still say "JSON only" and the parse still runs
// through `extractJson` — both harmless belt-and-braces.
export type JsonSchema = Record<string, unknown>;

function strictObject(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const ROLE_SCHEMA = strictObject({
  name: { type: "string" },
  type: { type: "string", enum: ["Principal", "Supporting", "Ensemble"] },
});
const SCENE_SCHEMA = strictObject({
  actNumber: { type: "integer" },
  sceneNumber: { type: "integer" },
  title: { type: "string" },
});

export const ANALYSIS_SCHEMA_TEXT: JsonSchema = strictObject({
  title: { type: "string" },
  roles: { type: "array", items: ROLE_SCHEMA },
  scenes: { type: "array", items: SCENE_SCHEMA },
  bookmarks: {
    type: "array",
    items: strictObject({
      kind: { type: "string", enum: ["scene", "song"] },
      title: { type: "string" },
      anchor: { type: "string" },
    }),
  },
});

export const ANALYSIS_SCHEMA_VISION: JsonSchema = strictObject({
  title: { type: "string" },
  roles: { type: "array", items: ROLE_SCHEMA },
  scenes: { type: "array", items: SCENE_SCHEMA },
  bookmarks: {
    type: "array",
    items: strictObject({
      kind: { type: "string", enum: ["scene", "song"] },
      title: { type: "string" },
      page: { type: "integer" },
    }),
  },
});

export const SECTIONS_SCHEMA: JsonSchema = strictObject({
  sections: {
    type: "array",
    items: strictObject({
      kind: { type: "string", enum: ["libretto", "vocal_score", "front_matter", "other"] },
      startPage: { type: "integer" },
      endPage: { type: "integer" },
      label: { type: "string" },
    }),
  },
});

export const SAMPLE_PAGES_SCHEMA: JsonSchema = strictObject({
  pages: {
    type: "array",
    items: strictObject({
      i: { type: "integer" },
      kind: { type: "string", enum: ["dialogue", "music", "front_matter", "other"] },
    }),
  },
});

export const FIRST_PAGE_SCHEMA: JsonSchema = strictObject({
  firstPage: { type: "integer" },
});

