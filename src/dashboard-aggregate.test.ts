import { test, expect } from "bun:test";
import { aggregateDay } from "./dashboard-aggregate.js";
import type { Meal, WaterEntry, NutritionGoals } from "./supabase.js";

function meal(
    overrides: Partial<Meal> & {
        description: string;
        meal_type: Meal["meal_type"];
    },
): Meal {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        user_id: "u1",
        logged_at: overrides.logged_at ?? "2026-06-23T12:00:00Z",
        meal_type: overrides.meal_type,
        description: overrides.description,
        calories: overrides.calories ?? 0,
        protein_g: overrides.protein_g ?? 0,
        carbs_g: overrides.carbs_g ?? 0,
        fat_g: overrides.fat_g ?? 0,
        notes: overrides.notes ?? null,
        idempotency_key: null,
    };
}

const TZ = "Europe/Warsaw"; // CEST (+02:00) on 2026-06-23
const DATE = "2026-06-23";

test("groups foods by meal in canonical order, skipping empty meals", () => {
    // Provided out of order and with a gap (no lunch) — output must be
    // breakfast, dinner, snack.
    const meals = [
        meal({ description: "Salmone", meal_type: "dinner", logged_at: "2026-06-23T19:00:00Z" }),
        meal({ description: "Avena", meal_type: "breakfast", logged_at: "2026-06-23T06:00:00Z" }),
        meal({ description: "Kefir", meal_type: "snack", logged_at: "2026-06-23T16:00:00Z" }),
    ];
    const view = aggregateDay(meals, [], null, DATE, TZ);
    expect(view.meals.map((m) => m.meal_type)).toEqual(["breakfast", "dinner", "snack"]);
});

test("sums macros and fibre per food, per meal, and per day", () => {
    const meals = [
        meal({ description: "Avena", meal_type: "breakfast", calories: 190, protein_g: 7, carbs_g: 34, fat_g: 3, notes: "Fibra: 5 g", logged_at: "2026-06-23T06:00:00Z" }),
        meal({ description: "Skyr", meal_type: "breakfast", calories: 96, protein_g: 18, carbs_g: 6, fat_g: 0, notes: "Fibra: 0 g", logged_at: "2026-06-23T06:00:00Z" }),
        meal({ description: "Fagioli", meal_type: "lunch", calories: 253, protein_g: 17, carbs_g: 46, fat_g: 1, notes: "Fibra: 11 g", logged_at: "2026-06-23T13:00:00Z" }),
    ];
    const view = aggregateDay(meals, [], null, DATE, TZ);

    const breakfast = view.meals.find((m) => m.meal_type === "breakfast")!;
    expect(breakfast.subtotal).toEqual({ calories: 286, protein_g: 25, carbs_g: 40, fat_g: 3, fiber_g: 5 });

    expect(view.total).toEqual({ calories: 539, protein_g: 42, carbs_g: 86, fat_g: 4, fiber_g: 16 });
});

test("derives local clock time from the stored UTC instant", () => {
    const meals = [
        meal({ description: "Cena", meal_type: "dinner", logged_at: "2026-06-23T19:00:00Z" }),
    ];
    const view = aggregateDay(meals, [], null, DATE, TZ);
    expect(view.meals[0]!.items[0]!.local_time).toBe("21:00"); // 19:00Z + 2h CEST
});

test("totals water and surfaces goals when present", () => {
    const water: WaterEntry[] = [
        { id: "w1", user_id: "u1", amount_ml: 300, logged_at: "2026-06-23T16:00:00Z", notes: null, created_at: "", idempotency_key: null },
        { id: "w2", user_id: "u1", amount_ml: 250, logged_at: "2026-06-23T18:00:00Z", notes: null, created_at: "", idempotency_key: null },
    ];
    const goals: NutritionGoals = {
        user_id: "u1",
        daily_calories: 2200,
        daily_protein_g: 160,
        daily_carbs_g: null,
        daily_fat_g: null,
        daily_water_ml: 2500,
        updated_at: "",
    };
    const view = aggregateDay([], water, goals, DATE, TZ);
    expect(view.water_ml).toBe(550);
    expect(view.goals?.calories).toBe(2200);
    expect(view.goals?.carbs_g).toBeNull();
});

test("rounds float macro sums to one decimal", () => {
    const meals = [
        meal({ description: "a", meal_type: "snack", protein_g: 0.1 }),
        meal({ description: "b", meal_type: "snack", protein_g: 0.2 }),
    ];
    const view = aggregateDay(meals, [], null, DATE, TZ);
    expect(view.total.protein_g).toBe(0.3); // not 0.30000000000000004
});
