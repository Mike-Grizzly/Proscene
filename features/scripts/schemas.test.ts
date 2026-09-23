import { describe, it, expect } from "vitest";
import {
  ANALYSIS_SCHEMA_TEXT,
  ANALYSIS_SCHEMA_VISION,
  SECTIONS_SCHEMA,
  SAMPLE_PAGES_SCHEMA,
  FIRST_PAGE_SCHEMA,
  type JsonSchema,
} from "./schemas";

/** Every object in a structured-output schema must be strict for the API to enforce it. */
function assertStrict(schema: JsonSchema, path = "$") {
  if (schema.type === "object") {
    const props = schema.properties as Record<string, JsonSchema>;
    expect(schema.additionalProperties, `${path}.additionalProperties`).toBe(false);
    expect(schema.required, `${path}.required`).toEqual(Object.keys(props));
    for (const [k, v] of Object.entries(props)) assertStrict(v, `${path}.${k}`);
  } else if (schema.type === "array") {
    assertStrict(schema.items as JsonSchema, `${path}[]`);
  }
}

describe("structured-output schemas", () => {
  it.each([
    ["text analysis", ANALYSIS_SCHEMA_TEXT],
    ["vision analysis", ANALYSIS_SCHEMA_VISION],
    ["sections", SECTIONS_SCHEMA],
    ["sample pages", SAMPLE_PAGES_SCHEMA],
    ["first page", FIRST_PAGE_SCHEMA],
  ])("%s schema is strict throughout", (_, schema) => {
    assertStrict(schema);
  });
  it("text and vision analyses differ only in the bookmark locator", () => {
    const t = (ANALYSIS_SCHEMA_TEXT.properties as Record<string, JsonSchema>).bookmarks;
    const v = (ANALYSIS_SCHEMA_VISION.properties as Record<string, JsonSchema>).bookmarks;
    const keys = (s: JsonSchema) => Object.keys((s.items as JsonSchema).properties as object);
    expect(keys(t)).toEqual(["kind", "title", "anchor"]);
    expect(keys(v)).toEqual(["kind", "title", "page"]);
  });
});
