import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ADMIN_ID = "20e3df23-9f5a-4d88-8adc-093f75feb5df";
const ADMIN_EMAIL = "theslyapex@gmail.com";
const ALLOWED = new Set(["https://alishams.ir", "https://www.alishams.ir"]);
const headers = (origin: string) => ({
  "Access-Control-Allow-Origin": ALLOWED.has(origin) ? origin : "https://alishams.ir",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-automation-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
});
const out = (body: unknown, status = 200, origin = "") =>
  new Response(JSON.stringify(body), { status, headers: headers(origin) });
const text = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max);
const dateTehran = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());
const addDays = (iso: string, days: number) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 86400000);
const esc = (v: string) => v.replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c] || c));

type Rule = { rule_key: string; enabled: boolean; settings: Record<string, unknown> };
type QueueItem = Record<string, any>;

async function sendTelegram(message: string) {
  const bot = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
  const chat = Deno.env.get("TELEGRAM_CHAT_ID") || "";
  if (!bot || !chat) throw new Error("تنظیمات تلگرام کامل نیست.");
  const response = await fetch("https://api.telegram.org/bot" + bot + "/sendMessage", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: message.slice(0, 3900), disable_web_page_preview: true }),
    signal: AbortSignal.timeout(12000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.ok !== true) throw new Error("ارسال تلگرام ناموفق بود.");
}

async function sendEmail(to: string, subject: string, message: string) {
  const key = Deno.env.get("RESEND_API_KEY") || "";
  if (!key) throw new Error("کلید ارسال ایمیل تنظیم نشده است.");
  const safeSubject = subject.replace(/[\r\n]/g, " ").slice(0, 180);
  const html = '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;background:#0b0d12;color:#f4f5f8;padding:28px;border-radius:18px;line-height:2"><div style="color:#d6ff59;font-weight:bold;letter-spacing:2px">ALISHAMS STUDIO</div><h2 style="font-size:20px">' + esc(subject) + '</h2><p style="white-space:pre-line">' + esc(message) + '</p><p><a href="https://alishams.ir/account.html" style="display:inline-block;background:#d6ff59;color:#10120b;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:bold">ورود به حساب کاربری</a></p></div>';
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Alishams Studio <info@alishams.ir>",
      to: [to], subject: safeSubject, html, text: message + "\n\nhttps://alishams.ir/account.html"
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error("ارسال ایمیل ناموفق بود: " + response.status);
}

async function deliver(db: any, item: QueueItem, serviceKey: string, supabaseUrl: string) {
  const delivered = new Set<string>(Array.isArray(item.delivered_channels) ? item.delivered_channels : []);
  const channels: string[] = Array.isArray(item.channels) ? item.channels : [];
  for (const channel of channels) {
    if (delivered.has(channel)) continue;
    if (channel === "telegram") {
      await sendTelegram("🔔 اتوماسیون Alishams\n\n" + item.title + "\n" + item.message + "\n\nشناسه: " + item.target_id);
    } else if (channel === "email") {
      if (!item.recipient_email) throw new Error("ایمیل گیرنده ثبت نشده است.");
      await sendEmail(item.recipient_email, item.title, item.message);
    } else if (channel === "account") {
      if (item.user_id) {
        const { error } = await db.from("account_notifications").upsert({
          user_id: item.user_id, source: "automation", source_id: text(item.target_id, 120),
          event_key: text(item.event_key, 80), title: text(item.title, 160), body: text(item.message, 1200)
        }, { onConflict: "user_id,source,source_id,event_key", ignoreDuplicates: true });
        if (error) throw error;
      }
    } else if (channel === "push") {
      if (item.project_id) {
        const response = await fetch(supabaseUrl + "/functions/v1/push-dispatcher", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + serviceKey },
          body: JSON.stringify({ project_id: item.project_id, title: item.title, message: item.message })
        });
        if (!response.ok && response.status !== 404) throw new Error("ارسال Push ناموفق بود: " + response.status);
      }
    }
    delivered.add(channel);
    const { error: saveError } = await db.from("automation_queue")
      .update({ delivered_channels: Array.from(delivered), updated_at: new Date().toISOString() })
      .eq("id", item.id);
    if (saveError) throw saveError;
  }
  return delivered.size >= channels.length;
}

async function processEngine(db: any, source: string, serviceKey: string, supabaseUrl: string) {
  const { data: run, error: runError } = await db.from("automation_runs")
    .insert({ trigger_source: source, status: "running" }).select("id").single();
  if (runError) throw runError;
  let scanned = 0, enqueued = 0, processed = 0, sent = 0, failed = 0, skipped = 0;
  const errors: string[] = [];
  try {
    const { data: ruleRows, error: ruleError } = await db.from("automation_rules").select("rule_key,enabled,settings");
    if (ruleError) throw ruleError;
    const rules = new Map<string, Rule>((ruleRows || []).map((r: Rule) => [r.rule_key, r]));
    const enabled = (key: string) => rules.get(key)?.enabled === true;
    const userFor = async (email: string) => {
      if (!email) return null;
      const { data, error } = await db.rpc("automation_user_id_by_email", { p_email: email });
      if (error) throw error;
      return data || null;
    };
    const enqueue = async (rule: string, targetType: string, targetId: string, data: {
      email?: string; userId?: string | null; projectId?: string | null; title: string; message: string;
      channels: string[]; eventSuffix?: string; payload?: Record<string, unknown>
    }) => {
      if (!enabled(rule)) return false;
      const email = text(data.email, 254).toLowerCase();
      const userId = data.userId || await userFor(email);
      const eventKey = text(rule + ":" + targetId + (data.eventSuffix ? ":" + data.eventSuffix : ""), 180);
      const { error } = await db.from("automation_queue").upsert({
        rule_key: rule, event_key: eventKey, target_type: targetType, target_id: text(targetId, 120),
        user_id: userId, recipient_email: email, project_id: data.projectId || null,
        title: text(data.title, 160), message: text(data.message, 1200),
        channels: data.channels, payload: data.payload || {}, due_at: new Date().toISOString(),
        status: "pending", next_attempt_at: new Date().toISOString()
      }, { onConflict: "event_key", ignoreDuplicates: true });
      if (error) throw error;
      enqueued++;
      return true;
    };

    const now = Date.now();
    const today = dateTehran();
    const { data: orders, error: orderError } = await db.from("client_orders")
      .select("id,tracking_code,client_name,client_email,title,status,created_at,updated_at")
      .in("status", ["new", "reviewing", "awaiting_customer"])
      .order("created_at", { ascending: true }).limit(500);
    if (orderError) throw orderError;
    scanned += (orders || []).length;
    for (const order of orders || []) {
      const ageHours = (now - Date.parse(order.updated_at || order.created_at)) / 3600000;
      const label = order.title || order.tracking_code || "سفارش";
      if (["new", "reviewing"].includes(order.status)) {
        if (ageHours >= 4) await enqueue("order_review_4h", "order", order.id, {
          title: "سفارش بررسی‌نشده", message: "سفارش " + label + " با کد " + order.tracking_code + " بیش از ۴ ساعت در انتظار بررسی است.",
          channels: ["telegram"], eventSuffix: "first"
        });
        if (ageHours >= 24) await enqueue("order_review_24h", "order", order.id, {
          title: "یادآوری دوم سفارش بررسی‌نشده", message: "سفارش " + label + " با کد " + order.tracking_code + " بیش از ۲۴ ساعت تعیین‌تکلیف نشده است.",
          channels: ["telegram"], eventSuffix: "second"
        });
      }
      if (order.status === "awaiting_customer" && ageHours >= 24 && order.client_email) {
        await enqueue("customer_offer_24h", "order", order.id, {
          email: order.client_email, title: "یادآوری پیشنهاد همکاری",
          message: "پیشنهاد مربوط به سفارش «" + label + "» هنوز منتظر پاسخ شماست. برای مشاهده جزئیات و اعلام نظر وارد حساب کاربری شوید.",
          channels: ["email", ...(order.client_email ? ["account"] : [])], eventSuffix: "customer"
        });
      }
    }

    const { data: projects, error: projectError } = await db.from("client_projects")
      .select("id,tracking_code,client_name,client_email,title,status,total_price,target_date,created_at,updated_at")
      .not("status", "in", '("completed","cancelled","on_hold")')
      .order("created_at", { ascending: true }).limit(500);
    if (projectError) throw projectError;
    scanned += (projects || []).length;
    const projectIds = (projects || []).map((p: any) => p.id);
    const paymentTotals = new Map<string, { total: number; last: number }>();
    if (projectIds.length) {
      const { data: payments, error: paymentError } = await db.from("project_payments")
        .select("project_id,amount,paid_at,confirmed").in("project_id", projectIds);
      if (paymentError) throw paymentError;
      for (const p of payments || []) {
        const item = paymentTotals.get(p.project_id) || { total: 0, last: 0 };
        if (p.confirmed) {
          item.total += Number(p.amount || 0);
          item.last = Math.max(item.last, p.paid_at ? Date.parse(p.paid_at) : 0);
        }
        paymentTotals.set(p.project_id, item);
      }
    }
    for (const project of projects || []) {
      const title = project.title || project.tracking_code || "پروژه";
      if (project.target_date) {
        const days = daysBetween(project.target_date, today);
        if (days === 3 || days === 1 || days < 0) {
          const rule = days === 3 ? "project_due_3d" : days === 1 ? "project_due_1d" : "project_overdue_daily";
          const suffix = days < 0 ? today : "once";
          const message = days < 0
            ? "موعد تحویل پروژه «" + title + "» گذشته است. لطفاً وضعیت و زمان‌بندی را بررسی کنید."
            : "موعد تحویل پروژه «" + title + "» " + (days === 3 ? "سه روز" : "یک روز") + " دیگر است.";
          await enqueue(rule, "project", project.id, {
            email: project.client_email, projectId: project.id, title: days < 0 ? "پروژه دارای تأخیر" : "یادآوری موعد پروژه",
            message: message + " کد پیگیری: " + project.tracking_code,
            channels: days < 0
              ? ["telegram"]
              : ["telegram", ...(project.client_email ? ["email", "account", "push"] : [])],
            eventSuffix: suffix
          });
        }
      }
      const paid = paymentTotals.get(project.id) || { total: 0, last: 0 };
      const balance = Math.max(0, Number(project.total_price || 0) - paid.total);
      const since = paid.last || Date.parse(project.created_at);
      if (balance > 0 && (now - since) >= 7 * 86400000) {
        const week = addDays(today, -((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7));
        await enqueue("project_balance_7d", "project", project.id, {
          title: "مانده پرداخت پروژه", message: "پروژه «" + title + "» دارای مانده " + balance.toLocaleString("fa-IR") + " تومان است. مشتری: " + (project.client_name || "نامشخص") + " · " + (project.client_email || "بدون ایمیل"),
          channels: ["telegram"], eventSuffix: week
        });
      }
    }

    const { data: completed, error: completedError } = await db.from("client_projects")
      .select("id,tracking_code,client_name,client_email,title,updated_at,status")
      .eq("status", "completed").lte("updated_at", new Date(now - 2 * 86400000).toISOString()).limit(300);
    if (completedError) throw completedError;
    scanned += (completed || []).length;
    if ((completed || []).length) {
      const ids = completed.map((p: any) => p.id);
      const { data: reviews, error: reviewError } = await db.from("project_reviews").select("project_id").in("project_id", ids);
      if (reviewError) throw reviewError;
      const reviewed = new Set((reviews || []).map((r: any) => r.project_id));
      for (const project of completed || []) {
        if (reviewed.has(project.id)) continue;
        if (project.client_email) {
          await enqueue("project_review_2d", "project", project.id, {
            email: project.client_email, projectId: project.id, title: "ثبت تجربه همکاری",
            message: "پروژه «" + (project.title || "شما") + "» تکمیل شده است. خوشحال می‌شویم تجربه همکاری‌تان را از طریق حساب کاربری ثبت کنید.",
            channels: ["email", "account", "push"], eventSuffix: "review"
          });
          if ((now - Date.parse(project.updated_at)) >= 7 * 86400000) {
            await enqueue("project_review_followup_7d", "project", project.id, {
              email: project.client_email, projectId: project.id, title: "یادآوری ثبت دیدگاه پروژه",
              message: "اگر فرصت نکرده‌اید، هنوز می‌توانید تجربه همکاری درباره پروژه «" + (project.title || "شما") + "» را در حساب کاربری ثبت کنید.",
              channels: ["email", "account"], eventSuffix: "followup"
            });
          }
        }
      }
    }

    const { data: memberships, error: membershipError } = await db.from("plus_memberships")
      .select("user_id,email,ends_at,status").eq("status", "active").not("ends_at", "is", null)
      .lte("ends_at", new Date(now + 86400000).toISOString()).limit(500);
    if (membershipError) throw membershipError;
    scanned += (memberships || []).length;
    for (const m of memberships || []) {
      const expired = Date.parse(m.ends_at) <= now;
      if (expired) {
        await enqueue("plus_expired", "membership", m.user_id, {
          email: m.email, userId: m.user_id, title: "اعتبار پلاس+ به پایان رسید",
          message: "اعتبار عضویت پلاس+ شما به پایان رسیده است. برای فعال‌سازی دوباره می‌توانید شرایط تمدید را در صفحه پلاس+ ببینید.",
          channels: ["email"], eventSuffix: new Date(m.ends_at).toISOString()
        });
        await db.from("plus_memberships").update({ status: "inactive", updated_at: new Date().toISOString() })
          .eq("user_id", m.user_id).eq("status", "active").lte("ends_at", new Date().toISOString());
      } else {
        const hoursLeft = (Date.parse(m.ends_at) - now) / 3600000;
        const rule = hoursLeft <= 12 ? "plus_expiry_today" : "plus_expiry_1d";
        await enqueue(rule, "membership", m.user_id, {
          email: m.email, userId: m.user_id,
          title: hoursLeft <= 12 ? "یادآوری پایان امروز پلاس+" : "یک روز تا پایان پلاس+",
          message: hoursLeft <= 12
            ? "اعتبار عضویت پلاس+ شما در ۱۲ ساعت آینده به پایان می‌رسد. در صورت تمایل، تمدید را پیش از پایان اعتبار انجام دهید."
            : "اعتبار عضویت پلاس+ شما کمتر از ۲۴ ساعت دیگر به پایان می‌رسد. در صورت تمایل، تمدید را پیش از پایان اعتبار انجام دهید.",
          channels: ["email", "account"], eventSuffix: new Date(m.ends_at).toISOString()
        });
      }
    }

    const { data: receipts, error: receiptError } = await db.from("plus_purchase_records")
      .select("id,email,created_at,amount_toman,payment_status,receipt_path,payment_provider")
      .eq("payment_provider", "card_transfer").eq("payment_status", "pending").not("receipt_path", "is", null)
      .lte("created_at", new Date(now - 6 * 3600000).toISOString()).limit(200);
    if (receiptError) throw receiptError;
    scanned += (receipts || []).length;
    for (const r of receipts || []) await enqueue("plus_receipt_review_6h", "plus_purchase", r.id, {
      title: "رسید پلاس+ در انتظار بررسی", message: "رسید عضویت پلاس+ برای " + r.email + " به مبلغ " + Number(r.amount_toman || 0).toLocaleString("fa-IR") + " تومان بیش از ۶ ساعت در انتظار بررسی است.",
      channels: ["telegram"], eventSuffix: "review"
    });

    const { data: subscribers, error: subscriberError } = await db.from("newsletter_subscribers")
      .select("id,email,confirmed_at,status").eq("status", "active").not("confirmed_at", "is", null)
      .lte("confirmed_at", new Date(now - 2 * 86400000).toISOString()).limit(500);
    if (subscriberError) throw subscriberError;
    scanned += (subscribers || []).length;
    for (const subscriber of subscribers || []) {
      const ageDays = (now - Date.parse(subscriber.confirmed_at)) / 86400000;
      if (ageDays >= 2) await enqueue("newsletter_intro_2d", "newsletter", subscriber.id, {
        email: subscriber.email, title: "با خدمات Alishams Studio بیشتر آشنا شوید",
        message: "در Alishams Studio می‌توانید خدمات طراحی وب‌سایت، موشن‌گرافیک و محتوای تبلیغاتی را متناسب با نیاز کسب‌وکار خود بررسی کنید. برای مشاهده خدمات و نمونه‌کارها به وب‌سایت سر بزنید: https://alishams.ir",
        channels: ["email"], eventSuffix: "intro"
      });
      if (ageDays >= 5) await enqueue("newsletter_guide_5d", "newsletter", subscriber.id, {
        email: subscriber.email, title: "راهنمای آماده‌سازی یک سفارش دقیق",
        message: "برای شروع یک پروژه بهتر است هدف، مخاطب، نمونه‌های مورد علاقه، امکانات موردنیاز و زمان‌بندی تقریبی را مشخص کنید. این اطلاعات کمک می‌کند پیشنهاد دقیق‌تری دریافت کنید. ثبت سفارش: https://alishams.ir",
        channels: ["email"], eventSuffix: "guide"
      });
    }

    const { data: domains, error: domainError } = await db.from("customer_domains")
      .select("id,user_id,customer_name,customer_email,domain_name,expires_at,status")
      .eq("status", "active").lte("expires_at", addDays(today, 30)).gte("expires_at", today).limit(500);
    if (domainError) throw domainError;
    scanned += (domains || []).length;
    for (const domain of domains || []) {
      const days = daysBetween(domain.expires_at, today);
      const rule = days === 30 ? "domain_expiry_30d" : days === 14 ? "domain_expiry_14d" : days === 7 ? "domain_expiry_7d" : days === 1 ? "domain_expiry_1d" : "";
      if (!rule) continue;
      await enqueue(rule, "domain", domain.id, {
        email: domain.customer_email, userId: domain.user_id, title: "یادآوری تمدید دامنه " + domain.domain_name,
        message: "اعتبار دامنه " + domain.domain_name + " در تاریخ " + domain.expires_at + " به پایان می‌رسد. برای جلوگیری از قطع سرویس، وضعیت تمدید را با ثبت‌کننده دامنه بررسی کنید.",
        channels: ["email", ...(domain.user_id ? ["account"] : [])], eventSuffix: domain.expires_at
      });
    }
    await db.from("customer_domains").update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("status", "active").lt("expires_at", today);

    const { error: plusIntentError } = await db.from("plus_payment_intents")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .in("status", ["pending", "precheckout"]).lte("expires_at", new Date().toISOString());
    if (plusIntentError) throw plusIntentError;
    const { error: projectIntentError } = await db.from("bale_payment_intents")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .in("status", ["pending", "precheckout"]).lte("expires_at", new Date().toISOString());
    if (projectIntentError) throw projectIntentError;

    await db.from("automation_queue").update({ status: "pending", locked_at: null, next_attempt_at: new Date().toISOString() })
      .eq("status", "processing").lt("locked_at", new Date(now - 20 * 60000).toISOString());

    const { data: jobs, error: claimError } = await db.rpc("claim_automation_queue", { p_limit: 30 });
    if (claimError) throw claimError;
    for (const job of jobs || []) {
      processed++;
      try {
        const done = await deliver(db, job, serviceKey, supabaseUrl);
        if (done) {
          await db.from("automation_queue").update({ status: "sent", sent_at: new Date().toISOString(), locked_at: null, last_error: "", updated_at: new Date().toISOString() }).eq("id", job.id);
          sent++;
        } else {
          await db.from("automation_queue").update({ status: "pending", locked_at: null, next_attempt_at: new Date(Date.now() + 5 * 60000).toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
          skipped++;
        }
      } catch (error) {
        const msg = text(error instanceof Error ? error.message : error, 500);
        const terminal = Number(job.attempts || 0) >= Number(job.max_attempts || 5);
        const delay = Math.min(240, 5 * Math.pow(2, Math.max(0, Number(job.attempts || 1) - 1)));
        await db.from("automation_queue").update({
          status: terminal ? "failed" : "pending", locked_at: null,
          next_attempt_at: new Date(Date.now() + delay * 60000).toISOString(),
          last_error: msg, updated_at: new Date().toISOString()
        }).eq("id", job.id);
        failed++;
        if (errors.length < 5) errors.push(msg);
      }
    }
    const status = failed ? (sent || enqueued ? "partial" : "failed") : "completed";
    await db.from("automation_runs").update({
      status, scanned_count: scanned, enqueued_count: enqueued, processed_count: processed,
      sent_count: sent, failed_count: failed, skipped_count: skipped,
      error_summary: errors.join(" | ").slice(0, 1800), finished_at: new Date().toISOString()
    }).eq("id", run.id);
    return { run_id: run.id, status, scanned, enqueued, processed, sent, failed, skipped, errors };
  } catch (error) {
    const msg = text(error instanceof Error ? error.message : error, 1500);
    await db.from("automation_runs").update({
      status: "failed", scanned_count: scanned, enqueued_count: enqueued,
      processed_count: processed, sent_count: sent, failed_count: failed + 1,
      error_summary: msg, finished_at: new Date().toISOString()
    }).eq("id", run.id);
    throw error;
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (req.method !== "POST") return out({ error: "Method not allowed" }, 405, origin);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !anonKey || !serviceKey) return out({ error: "Automation service is not configured" }, 503, origin);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const body = await req.json().catch(() => ({}));
    const cronToken = req.headers.get("x-automation-token") || "";
    if (cronToken) {
      const { data: valid, error } = await db.rpc("verify_automation_cron_token", { p_token: cronToken });
      if (error || valid !== true) return out({ error: "Unauthorized scheduler" }, 401, origin);
      const result = await processEngine(db, "cron", serviceKey, supabaseUrl);
      return out({ ok: true, ...result }, 200, origin);
    }
    if (!ALLOWED.has(origin)) return out({ error: "Origin not allowed" }, 403, origin);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return out({ error: "نشست مدیر معتبر نیست." }, 401, origin);
    const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    const user = authData?.user;
    if (authError || user?.id !== ADMIN_ID || user?.email?.toLowerCase() !== ADMIN_EMAIL)
      return out({ error: "دسترسی فقط برای مدیر مجاز است." }, 403, origin);
    const action = text(body.action || "dashboard", 40);
    if (action === "run_now") {
      const result = await processEngine(db, "manual", serviceKey, supabaseUrl);
      return out({ ok: true, ...result }, 200, origin);
    }
    if (action === "dashboard") {
      const [rules, queue, runs, domains, pendingCount, failedCount] = await Promise.all([
        db.from("automation_rules").select("*").order("rule_key"),
        db.from("automation_queue").select("id,rule_key,event_key,target_type,target_id,title,status,attempts,max_attempts,last_error,created_at,sent_at").order("created_at", { ascending: false }).limit(60),
        db.from("automation_runs").select("*").order("started_at", { ascending: false }).limit(20),
        db.from("customer_domains").select("*").order("expires_at", { ascending: true }).limit(200),
        db.from("automation_queue").select("id", { count: "exact", head: true }).in("status", ["pending", "processing"]),
        db.from("automation_queue").select("id", { count: "exact", head: true }).eq("status", "failed")
      ]);
      for (const r of [rules, queue, runs, domains, pendingCount, failedCount]) if (r.error) throw r.error;
      return out({
        ok: true, rules: rules.data || [], queue: queue.data || [], runs: runs.data || [], domains: domains.data || [],
        counts: { pending: pendingCount.count || 0, failed: failedCount.count || 0 }
      }, 200, origin);
    }
    if (action === "rule_update") {
      const key = text(body.rule_key, 100);
      const { data, error } = await db.from("automation_rules").update({ enabled: !!body.enabled, updated_at: new Date().toISOString() }).eq("rule_key", key).select("*").single();
      if (error) throw error;
      return out({ ok: true, rule: data }, 200, origin);
    }
    if (action === "domain_upsert") {
      const id = text(body.id, 50);
      const email = text(body.customer_email, 254).toLowerCase();
      const domain = text(body.domain_name, 253).toLowerCase();
      const expiry = text(body.expires_at, 10);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) || !/^\d{4}-\d{2}-\d{2}$/.test(expiry))
        return out({ error: "ایمیل، دامنه یا تاریخ انقضا معتبر نیست." }, 400, origin);
      const { data: linkedUser, error: userError } = await db.rpc("automation_user_id_by_email", { p_email: email });
      if (userError) throw userError;
      const patch = {
        user_id: linkedUser || null, customer_name: text(body.customer_name, 120), customer_email: email,
        domain_name: domain, registrar: text(body.registrar, 120), expires_at: expiry,
        auto_renew: !!body.auto_renew, status: text(body.status, 20) || "active",
        notes: text(body.notes, 1000), updated_at: new Date().toISOString()
      };
      const query = id ? db.from("customer_domains").update(patch).eq("id", id) : db.from("customer_domains").insert(patch);
      const { data, error } = await query.select("*").single();
      if (error) throw error;
      return out({ ok: true, domain: data }, 200, origin);
    }
    if (action === "domain_delete") {
      const id = text(body.id, 50);
      if (!id) return out({ error: "شناسه دامنه لازم است." }, 400, origin);
      const { error } = await db.from("customer_domains").delete().eq("id", id);
      if (error) throw error;
      return out({ ok: true }, 200, origin);
    }
    if (action === "retry_failed") {
      const { data, error } = await db.from("automation_queue").update({
        status: "pending", attempts: 0, next_attempt_at: new Date().toISOString(),
        locked_at: null, last_error: "", updated_at: new Date().toISOString()
      }).eq("status", "failed").select("id");
      if (error) throw error;
      return out({ ok: true, retried: data?.length || 0 }, 200, origin);
    }
    return out({ error: "عملیات نامعتبر است." }, 400, origin);
  } catch (error) {
    console.error("automation-engine", error);
    return out({ error: error instanceof Error ? error.message : "خطای داخلی اتوماسیون" }, 500, origin);
  }
});
