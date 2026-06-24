// Pure aggregation layer for the dashboard.
//
// Everything here is side-effect free and DB-free: it takes already-fetched
// rows and folds them into the per-food / per-meal / per-day shape the UI
// renders. Keeping it pure means it can be unit-tested without Supabase (see
// dashboard-aggregate.test.ts) and reused by both the HTTP API and the tests.
//
// `import type` (not a value import) is required here: tsconfig has
// verbatimModuleSyntax, and it also means this module never pulls the Supabase
// client into a test process.
import type { Meal, WaterEntry, NutritionGoals } from "./supabase.js";
import { parseFiberFromNotes } from "./fiber.js";
import { formatLocalDateTime } from "./tz.js";

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type GroupKey = MealType | "other";

// Canonical display order. Anything with an unexpected meal_type lands in
// "other" and sorts last so nothing is silently dropped.
const MEAL_ORDER: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

export interface MacroTotals {
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g: number;
}

export interface DayFoodItem extends MacroTotals {
    id: string;
    description: string;
    meal_type: GroupKey;
    logged_at: string; // absolute UTC instant
    local_time: string; // HH:mm in the user's timezone
}

export interface MealGroup {
    meal_type: GroupKey;
    items: DayFoodItem[];
    subtotal: MacroTotals;
}

export interface DayGoals {
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    water_ml: number | null;
}

export interface DayView {
    date: string; // YYYY-MM-DD (local)
    timezone: string; // IANA tz the day was bucketed in
    meals: MealGroup[]; // non-empty groups only, canonical order
    total: MacroTotals; // whole-day totals (fibre included)
    water_ml: number;
    goals: DayGoals | null;
}

function zero(): MacroTotals {
    return { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
}

function addInto(acc: MacroTotals, m: MacroTotals): void {
    acc.calories += m.calories;
    acc.protein_g += m.protein_g;
    acc.carbs_g += m.carbs_g;
    acc.fat_g += m.fat_g;
    acc.fiber_g += m.fiber_g;
}

// Round on the way out so float accumulation never leaks artefacts to the
// client: calories to whole numbers, macros + fibre to one decimal.
function rounded(t: MacroTotals): MacroTotals {
    return {
        calories: Math.round(t.calories),
        protein_g: Math.round(t.protein_g * 10) / 10,
        carbs_g: Math.round(t.carbs_g * 10) / 10,
        fat_g: Math.round(t.fat_g * 10) / 10,
        fiber_g: Math.round(t.fiber_g * 10) / 10,
    };
}

/**
 * Fold meal + water rows into the dashboard's day view. Pure function — all
 * timezone resolution and fibre parsing happen here over the supplied rows.
 */
export function aggregateDay(
    meals: Meal[],
    water: WaterEntry[],
    goals: NutritionGoals | null,
    date: string,
    tz: string,
): DayView {
    const groups = new Map<GroupKey, MealGroup>();
    const total = zero();

    for (const meal of meals) {
        const key: GroupKey = isMealType(meal.meal_type)
            ? meal.meal_type
            : "other";
        const item: DayFoodItem = {
            id: meal.id,
            description: meal.description,
            meal_type: key,
            logged_at: meal.logged_at,
            local_time: formatLocalDateTime(meal.logged_at, tz).slice(11, 16),
            calories: meal.calories ?? 0,
            protein_g: meal.protein_g ?? 0,
            carbs_g: meal.carbs_g ?? 0,
            fat_g: meal.fat_g ?? 0,
            fiber_g: parseFiberFromNotes(meal.notes),
        };

        let group = groups.get(key);
        if (!group) {
            group = { meal_type: key, items: [], subtotal: zero() };
            groups.set(key, group);
        }
        group.items.push(item);
        addInto(group.subtotal, item);
        addInto(total, item);
    }

    const ordered: MealGroup[] = [];
    for (const t of MEAL_ORDER) {
        const g = groups.get(t);
        if (g) ordered.push(g);
    }
    const other = groups.get("other");
    if (other) ordered.push(other);

    for (const g of ordered) {
        g.items = g.items.map((i) => ({ ...i, ...rounded(i) }));
        g.subtotal = rounded(g.subtotal);
    }

    const water_ml = water.reduce((s, w) => s + (w.amount_ml ?? 0), 0);

    return {
        date,
        timezone: tz,
        meals: ordered,
        total: rounded(total),
        water_ml,
        goals: goals
            ? {
                  calories: goals.daily_calories,
                  protein_g: goals.daily_protein_g,
                  carbs_g: goals.daily_carbs_g,
                  fat_g: goals.daily_fat_g,
                  water_ml: goals.daily_water_ml,
              }
            : null,
    };
}

function isMealType(v: string | null): v is MealType {
    return (
        v === "breakfast" || v === "lunch" || v === "dinner" || v === "snack"
    );
}
