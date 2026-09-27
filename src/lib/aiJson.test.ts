import { describe, expect, it } from "vitest";
import { extractJson, InvalidAnswer, parseAnswer, type Schema, validate } from "./aiJson";

describe("extractJson", () => {
  it("parses bare, fenced and chatty replies", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a": [1, 2]}\n```')).toEqual({ a: [1, 2] });
    expect(extractJson('Sure! Here it is:\n{"a": true}\nHope that helps.')).toEqual({ a: true });
    expect(extractJson("[1,2]")).toEqual([1, 2]);
  });

  it("explains what is wrong", () => {
    expect(() => extractJson("no json here")).toThrow(InvalidAnswer);
    expect(() => extractJson('{"a": 1,}')).toThrow(/not valid JSON/);
  });
});

const schema: Schema = {
  type: "object",
  props: {
    kind: { type: "string", enum: ["flowchart", "mindmap"] },
    nodes: {
      type: "array",
      min: 1,
      items: {
        type: "object",
        props: { id: { type: "string" }, x: { type: "number", optional: true } },
      },
    },
    done: { type: "boolean", optional: true },
  },
};

describe("validate", () => {
  it("accepts a matching value", () => {
    expect(validate({ kind: "mindmap", nodes: [{ id: "a" }, { id: "b", x: 2 }] }, schema)).toEqual(
      [],
    );
  });

  it("lists every problem with its location", () => {
    expect(validate({ kind: "pie", nodes: [{ x: "1" }], done: "yes" }, schema)).toEqual([
      '$.kind must be one of "flowchart", "mindmap"',
      "$.nodes[0].id is missing",
      "$.nodes[0].x must be a number, not string",
      "$.done must be true or false",
    ]);
    expect(validate({ kind: "flowchart", nodes: [] }, schema)).toEqual([
      "$.nodes needs at least 1 item(s)",
    ]);
    expect(validate([], schema)).toEqual(["$ must be an object, not array"]);
  });

  it("parseAnswer throws with the problems", () => {
    try {
      parseAnswer('{"kind":"flowchart"}', schema);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidAnswer);
      expect((e as InvalidAnswer).problems).toEqual(["$.nodes is missing"]);
    }
  });
});
