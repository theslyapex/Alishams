import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const ORIGINS = new Set(["https://alishams.ir", "https://www.alishams.ir"]);
const OWNER = "theslyapex@gmail.com";
const ADMIN_ID = "20e3df23-9f5a-4d88-8adc-093f75feb5df";
const headers = (origin: string) => ({
  "Access-Control-Allow-Origin": ORIGINS.has(origin) ? origin : "https://alishams.ir",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
});
const response = (body: unknown, status: number, origin: string) =>
  new Response(JSON.stringify(body), { status, headers: headers(origin) });
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405, origin);
  if (!ORIGINS.has(origin)) return response({ error: "Origin not allowed" }, 403, origin);
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!token || !url || !anon || !service) return response({ error: "نشست مدیر معتبر نیست؛ دوباره وارد شو." }, 401, origin);
    const auth = createClient(url, anon, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    if (authError || authData.user?.id !== ADMIN_ID || authData.user?.email?.toLowerCase() !== OWNER)
      return response({ error: "دسترسی فقط برای حساب مدیر مجاز است." }, 403, origin);
    const { data: claimsData, error: claimsError } = await auth.auth.getClaims(token);
    if (claimsError || claimsData?.claims?.aal !== "aal2") return response({ error: "برای عملیات مدیریتی، تأیید دومرحله‌ای لازم است." }, 403, origin);
    const db = createClient(url, service, { auth: { persistSession: false } });
    const audit = async (actionKey: string, entityId: string, summary: string, beforeData: unknown = null, afterData: unknown = null) => {
      const { error } = await db.from("admin_audit_logs").insert({ actor_user_id: authData.user!.id, actor_email: authData.user!.email || OWNER, action_key: actionKey, entity_type: "user_account", entity_id: entityId, summary, before_data: beforeData, after_data: afterData, metadata: { source: "admin-dashboard", auth_level: "aal2" } });
      if (error) throw error;
    };
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    if (action === "ban" || action === "unban" || action === "delete_user") {
      const userId = String(body.user_id || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId))
        return response({ error: "شناسه حساب معتبر نیست." }, 400, origin);
      const { data: targetData, error: targetError } = await db.auth.admin.getUserById(userId);
      if (targetError || !targetData.user) return response({ error: "حساب کاربر پیدا نشد." }, 404, origin);
      if (targetData.user.email?.toLowerCase() === OWNER) return response({ error: "حساب مدیر قابل حذف یا مسدودسازی نیست." }, 403, origin);
      if (action === "delete_user") {
        const { error } = await db.auth.admin.deleteUser(userId);
        if (error) throw error;
        await audit("account.deleted", userId, "حذف حساب کاربری", { exists: true }, { exists: false });
        return response({ ok: true, message: "حساب حذف شد." }, 200, origin);
      }
      const { error } = await db.auth.admin.updateUserById(userId, { ban_duration: action === "ban" ? "876000h" : "none" });
      if (error) throw error;
      await audit(action === "ban" ? "account.banned" : "account.unbanned", userId, action === "ban" ? "مسدودسازی حساب کاربری" : "رفع مسدودیت حساب کاربری", { banned: !!targetData.user.banned_until }, { banned: action === "ban" });
      return response({ ok: true, message: action === "ban" ? "حساب مسدود شد." : "مسدودیت برداشته شد." }, 200, origin);
    }
    if (action === "send_email") {
      const userId = String(body.user_id || "");
      const subject = String(body.subject || "").trim().slice(0, 180);
      const message = String(body.message || "").trim().slice(0, 5000);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId) || !subject || !message)
        return response({ error: "حساب، موضوع و متن ایمیل لازم است." }, 400, origin);
      const { data: targetData, error: targetError } = await db.auth.admin.getUserById(userId);
      if (targetError || !targetData.user?.email) return response({ error: "ایمیل کاربر پیدا نشد." }, 404, origin);
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (!resendKey) return response({ error: "ارسال ایمیل فعال نیست: Secret با نام RESEND_API_KEY در تنظیمات Supabase تعریف نشده است." }, 503, origin);
      const mail = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": "Bearer " + resendKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Alishams Studio <info@alishams.ir>",
          reply_to: "info@alishams.ir",
          to: [targetData.user.email],
          subject,
          text: message
        })
      });
      const mailData = await mail.json().catch(() => ({}));
      if (!mail.ok) {
        console.error("Resend send failed", mail.status, mailData);
        return response({ error: "Resend ایمیل را نپذیرفت؛ وضعیت کلید و دامنه فرستنده را بررسی کن.", detail: mailData.message || mailData.error || "" }, 502, origin);
      }
      await audit("account.email_sent", userId, "ارسال ایمیل به حساب کاربری", null, { sent: true });
      return response({ ok: true, message: "ایمیل ارسال شد.", email: targetData.user.email }, 200, origin);
    }
    if (action !== "list") return response({ error: "عملیات ناشناخته است." }, 400, origin);
    const [ordersR, projectsR, requestsR, messagesR, paymentsR, eventsR] = await Promise.all([
      db.from("client_orders").select("id,tracking_code,client_name,contact_info,client_email,service,title,details,budget,status,quoted_price,eta_date,public_message,internal_notes,project_id,created_at,updated_at").order("created_at", { ascending: false }).limit(1000),
      db.from("client_projects").select("id,tracking_code,client_name,client_email,title,description,status,progress,total_price,created_at,updated_at,target_date,internal_notes").order("created_at", { ascending: false }).limit(1000),
      db.from("communication_requests").select("id,tracking_code,sender_name,sender_email,subject,category,status,created_at,updated_at").order("created_at", { ascending: false }).limit(1000),
      db.from("communication_messages").select("*").order("created_at", { ascending: false }).limit(2000),
      db.from("project_payments").select("*").order("created_at", { ascending: false }).limit(2000),
      db.from("client_order_events").select("*").order("created_at", { ascending: false }).limit(2000)
    ]);
    for (const result of [ordersR, projectsR, requestsR, messagesR, paymentsR, eventsR]) {
      if (result.error) throw result.error;
    }
    const users: Record<string, unknown>[] = [];
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
      if (error) throw error;
      users.push(...(data.users || []).map((u: any) => ({
        id: u.id, email: u.email, phone: u.phone, created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at, email_confirmed_at: u.email_confirmed_at,
        phone_confirmed_at: u.phone_confirmed_at, banned_until: u.banned_until, role: u.role,
        app_metadata: u.app_metadata, user_metadata: u.user_metadata,
        identities: (u.identities || []).map((i: any) => ({ provider: i.provider }))
      })));
      if (!data.users || data.users.length < 100) break;
    }
    return response({ ok: true, users, orders: ordersR.data || [], projects: projectsR.data || [],
      requests: requestsR.data || [], messages: messagesR.data || [], payments: paymentsR.data || [],
      orderEvents: eventsR.data || [], generated_at: new Date().toISOString() }, 200, origin);
  } catch (error) {
    console.error("admin-dashboard error", error);
    return response({ error: "دریافت اطلاعات پنل مدیریت انجام نشد. تنظیمات و دسترسی‌های Supabase را بررسی کن." }, 500, origin);
  }
});