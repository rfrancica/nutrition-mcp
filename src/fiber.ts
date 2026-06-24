// Parse a structured fibre value out of a meal's free-text `notes`.
//
// The upstream schema has no fibre column, and this fork deliberately keeps it
// that way: fibre lives inside the existing `notes` field as a key/value that
// the dashboard reads back. The value is written once per food (at log time)
// and never recomputed, so reads are a pure extraction, not an estimate.
//
// Two formats are recognised, in priority order:
//   1. explicit tag   "fiber_g=5"                (machine-first, unambiguous)
//   2. human label    "Fibra: 5 g" / "Fiber: 5g" (the format in use today)
//
// Integer and decimal values are accepted; a comma decimal separator
// ("Fibra: 2,5 g") is normalised to a dot. Returns 0 when nothing matches, so
// notes that carry no fibre annotation simply contribute 0 to the totals.
export function parseFiberFromNotes(notes: string | null | undefined): number {
    if (!notes) return 0;
    const tag = notes.match(/fiber_g\s*=\s*(\d+(?:[.,]\d+)?)/i);
    const label = notes.match(/fib(?:ra|er)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*g?/i);
    const raw = (tag ?? label)?.[1];
    if (raw == null) return 0;
    const n = parseFloat(raw.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : 0;
}
