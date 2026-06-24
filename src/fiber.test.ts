import { test, expect } from "bun:test";
import { parseFiberFromNotes } from "./fiber.js";

test("parses the human label format Claude writes today", () => {
    expect(parseFiberFromNotes("Fibra: 5 g")).toBe(5);
    expect(parseFiberFromNotes("Fibra: 11 g")).toBe(11);
    expect(parseFiberFromNotes("Fiber: 7g")).toBe(7);
});

test("parses the explicit machine tag and prefers it", () => {
    expect(parseFiberFromNotes("fiber_g=6")).toBe(6);
    // tag wins over a stray label elsewhere in the note
    expect(parseFiberFromNotes("fiber_g=6 | Fibra: 99 g")).toBe(6);
});

test("accepts decimals and comma separators", () => {
    expect(parseFiberFromNotes("Fibra: 2,5 g")).toBe(2.5);
    expect(parseFiberFromNotes("fiber_g=0.5")).toBe(0.5);
});

test("returns 0 for missing, empty, or unrelated notes", () => {
    expect(parseFiberFromNotes(null)).toBe(0);
    expect(parseFiberFromNotes(undefined)).toBe(0);
    expect(parseFiberFromNotes("")).toBe(0);
    expect(parseFiberFromNotes("post-workout shake")).toBe(0);
});

test("yields 0 when no positive number follows the label", () => {
    // The pattern only captures unsigned digits, so a stray minus or junk
    // after the label is treated as "no fibre value" rather than guessed.
    expect(parseFiberFromNotes("Fibra: -3 g")).toBe(0);
    expect(parseFiberFromNotes("Fibra: tanta")).toBe(0);
});
