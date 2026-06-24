// Thin data layer for the dashboard: fetch the rows a single day needs, then
// hand them to the pure aggregator. Kept separate from dashboard-aggregate.ts
// so the aggregation logic stays unit-testable without a Supabase client.
import {
    getMealsByDate,
    getWaterByDate,
    getNutritionGoals,
    getUserTimezone,
} from "./supabase.js";
import { aggregateDay, type DayView } from "./dashboard-aggregate.js";

/**
 * Build the full day view for a user. `date` must be YYYY-MM-DD already
 * resolved to the user's timezone (the router resolves "today" upstream).
 */
export async function getDayView(
    userId: string,
    date: string,
): Promise<DayView> {
    const tz = await getUserTimezone(userId);
    const [meals, water, goals] = await Promise.all([
        getMealsByDate(userId, date, tz),
        getWaterByDate(userId, date, tz),
        getNutritionGoals(userId),
    ]);
    return aggregateDay(meals, water, goals, date, tz);
}
