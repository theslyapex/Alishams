import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ALLOWED = new Set(["https://alishams.ir", "https://www.alishams.ir"]);
const headers = (origin: string) => ({
  "Access-Control-Allow-Origin": ALLOWED.has(origin) ? origin : "https://alishams.ir",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
});
const out = (body: unknown, status: number, origin: string) =>
  new Response(JSON.stringify(body), { status, headers: headers(origin) });

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (req.method !== "POST") return out({ error: "Method not allowed" }, 405, origin);
  if (origin && !ALLOWED.has(origin)) return out({ error: "Origin not allowed" }, 403, origin);
  try {
    if (!URL || !SERVICE) return out({ error: "سرویس ثبت درخواست در دسترس نیست." }, 503, origin);
    const body = await req.json();
    const fullName = String(body?.full_name || "").trim().normalize("NFC");
    const email = String(body?.email || "").trim().toLowerCase();
    const phone = String(body?.phone || "").trim();
    const coins = Number(body?.coins || 0);
    const transactionReference = String(body?.transaction_reference || "").trim();
    const description = String(body?.description || "").trim();
    const mime = String(body?.receipt_mime || "");
    const base64 = String(body?.receipt_base64 || "").replace(/^data:[^;]+;base64,/, "");
    if (fullName.length < 2 || fullName.length > 80) return out({ error: "نام و نام خانوادگی را درست وارد کن." }, 400, origin);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return out({ error: "ایمیل معتبر وارد کن." }, 400, origin);
    if (phone.length < 8 || phone.length > 20) return out({ error: "شماره تماس معتبر وارد کن." }, 400, origin);
    if (!Number.isInteger(coins) || coins < 1000 || coins > 100000 || coins % 1000 !== 0) return out({ error: "تعداد سکه باید مضربی از ۱۰۰۰ باشد." }, 400, origin);
    if (description.length > 1500 || transactionReference.length > 120) return out({ error: "توضیحات یا شناسه تراکنش بیش از حد طولانی است." }, 400, origin);
    if (!["image/jpeg","image/png","image/webp","application/pdf"].includes(mime)) return out({ error: "رسید باید JPG، PNG، WEBP یا PDF باشد." }, 400, origin);
    if (!base64 || base64.length > 5600000) return out({ error: "فایل رسید خالی یا بزرگ‌تر از ۵ مگابایت است." }, 400, origin);
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    if (bytes.byteLength > 4 * 1024 * 1024) return out({ error: "حجم رسید نباید بیشتر از ۵ مگابایت باشد." }, 400, origin);
    const authHeader = req.headers.get("Authorization") || "";
    let userId: string | null = null;
    if (authHeader.startsWith("Bearer ") && ANON) {
      const auth = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data } = await auth.auth.getUser(authHeader.slice(7));
      userId = data?.user?.id || null;
    }
    const db = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
    const ext = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const requestCode = "BAL-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomUUID().slice(0, 6).toUpperCase();
    const path = new Date().toISOString().slice(0,10) + "/" + requestCode + "." + ext;
    const { error: uploadError } = await db.storage.from("baladi-coin-receipts").upload(path, bytes, { contentType: mime, upsert: false });
    if (uploadError) throw uploadError;
    const { error: insertError } = await db.from("baladi_coin_purchase_requests").insert({
      request_code: requestCode, user_id: userId, full_name: fullName, email, phone,
      coins, amount_toman: (coins / 1000) * 8900, transaction_reference: transactionReference,
      description, receipt_path: path, status: "pending"
    });
    if (insertError) {
      await db.storage.from("baladi-coin-receipts").remove([path]);
      throw insertError;
    }
    return out({ ok: true, request_code: requestCode, coins, amount_toman: (coins / 1000) * 8900 }, 201, origin);
  } catch (error) {
    console.error("baladi coin request error", error);
    return out({ error: "ثبت درخواست انجام نشد. چند دقیقه دیگر دوباره تلاش کن." }, 500, origin);
  }
});