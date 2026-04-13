import { supabase } from "./supabase.js";

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: string | null;
};

export async function checkRateLimit(
  key: string,
  windowMs: number,
  max: number
): Promise<RateLimitResult> {
  try {
    const { data, error } = await supabase.rpc("rate_limit_check", {
      p_key: key,
      p_window_ms: windowMs,
      p_max: max,
    });

    if (error) {
      console.error("[rate-limit] rpc error:", error);
      return { allowed: true, remaining: max, resetAt: null };
    }

    const row = Array.isArray(data) ? data[0] : data;
    return {
      allowed: Boolean(row?.allowed ?? true),
      remaining: Number(row?.remaining ?? max),
      resetAt: row?.reset_at ?? null,
    };
  } catch (err) {
    console.error("[rate-limit] check failed:", err);
    return { allowed: true, remaining: max, resetAt: null };
  }
}
