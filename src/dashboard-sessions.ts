// Browser session store for the dashboard.
//
// The /mcp endpoint authenticates with OAuth bearer tokens, which suit an AI
// client but not a browser. The dashboard instead uses an opaque, server-side
// session token kept in an HttpOnly cookie and validated against the
// `dashboard_sessions` table. Sessions are independent of OAuth tokens, so
// signing out of the dashboard never disturbs a connected Claude/ChatGPT
// session, and vice versa.
import { getSupabase } from "./supabase.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** 256 bits of CSPRNG entropy, hex-encoded. */
export function newSessionToken(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(userId: string): Promise<string> {
    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    const { error } = await getSupabase()
        .from("dashboard_sessions")
        .insert({ token, user_id: userId, expires_at: expiresAt });
    if (error) throw new Error(`Failed to create session: ${error.message}`);
    return token;
}

export async function getSessionUser(token: string): Promise<string | null> {
    const { data, error } = await getSupabase()
        .from("dashboard_sessions")
        .select("user_id")
        .eq("token", token)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
    if (error || !data) return null;
    return data.user_id as string;
}

export async function deleteSession(token: string): Promise<void> {
    // Best-effort: a failed logout cleanup should not surface as a 500.
    await getSupabase().from("dashboard_sessions").delete().eq("token", token);
}
