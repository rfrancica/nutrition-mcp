// Dashboard HTTP surface: a small cookie-session auth flow plus a read-only
// day-view JSON API the PWA front-end consumes. Mounted at the app root by
// index.ts. No data is mutated here — logging still happens through the MCP
// tools; this is purely a window onto the same Supabase data.
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { signInUser, getUserTimezone } from "./supabase.js";
import {
    createSession,
    getSessionUser,
    deleteSession,
} from "./dashboard-sessions.js";
import { getDayView } from "./dashboard-data.js";
import { todayInTz } from "./tz.js";

const COOKIE = "dash_session";

type Vars = { Variables: { dashUserId: string } };

function isHttps(c: Context): boolean {
    const proto =
        c.req.header("x-forwarded-proto") ??
        new URL(c.req.url).protocol.replace(":", "");
    return proto === "https";
}

function clientIp(c: Context): string {
    return (
        c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
        c.req.header("x-real-ip") ||
        "unknown"
    );
}

// Minimal per-IP brute-force guard for the login endpoint. In-memory, so it
// resets on restart and is per-instance — adequate for a single-instance
// personal deploy. For multi-instance or hostile traffic, front it with a WAF
// rate rule (see docs/ARCHITECTURE-AWS.md).
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

function loginAllowed(ip: string): boolean {
    const now = Date.now();
    const rec = attempts.get(ip);
    if (!rec || rec.resetAt < now) {
        attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
        return true;
    }
    rec.count += 1;
    return rec.count <= MAX_ATTEMPTS;
}

const requireSession = async (c: Context<Vars>, next: Next) => {
    const token = getCookie(c, COOKIE);
    const userId = token ? await getSessionUser(token) : null;
    if (!userId) return c.json({ error: "unauthorized" }, 401);
    c.set("dashUserId", userId);
    await next();
};

export function createDashboardRouter(): Hono<Vars> {
    const r = new Hono<Vars>();

    // Cheap probe so the front-end can decide between login form and data.
    r.get("/api/dashboard/session", async (c) => {
        const token = getCookie(c, COOKIE);
        const userId = token ? await getSessionUser(token) : null;
        return c.json({ authenticated: !!userId });
    });

    r.post("/api/dashboard/login", async (c) => {
        if (!loginAllowed(clientIp(c))) {
            return c.json({ error: "too_many_attempts" }, 429);
        }
        let body: { email?: string; password?: string };
        try {
            body = await c.req.json();
        } catch {
            return c.json({ error: "bad_request" }, 400);
        }
        const email = (body.email ?? "").trim();
        const password = body.password ?? "";
        if (!email || !password) {
            return c.json({ error: "missing_credentials" }, 400);
        }

        let userId: string;
        try {
            userId = await signInUser(email, password);
        } catch {
            // Uniform message: never reveal whether the email exists.
            return c.json({ error: "invalid_credentials" }, 401);
        }

        const token = await createSession(userId);
        setCookie(c, COOKIE, token, {
            httpOnly: true,
            secure: isHttps(c),
            sameSite: "Lax",
            path: "/",
            maxAge: 30 * 24 * 60 * 60,
        });
        return c.json({ ok: true });
    });

    r.post("/api/dashboard/logout", async (c) => {
        const token = getCookie(c, COOKIE);
        if (token) await deleteSession(token);
        deleteCookie(c, COOKIE, { path: "/" });
        return c.json({ ok: true });
    });

    // Day view. `:date` is YYYY-MM-DD, or the literal "today" which we resolve
    // against the user's stored timezone so the day boundary matches the MCP
    // tools exactly.
    r.get("/api/dashboard/day/:date", requireSession, async (c) => {
        const userId = c.get("dashUserId");
        let date = c.req.param("date") ?? "";
        if (date === "today") {
            date = todayInTz(await getUserTimezone(userId));
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return c.json({ error: "bad_date" }, 400);
        }
        const view = await getDayView(userId, date);
        return c.json(view);
    });

    return r;
}
