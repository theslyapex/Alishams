import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

async function notifyTelegram(text: string, photoUrl?: string) {
  const bot = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
  const chat = Deno.env.get("TELEGRAM_CHAT_ID") || "";
  if (!bot || !chat) { console.error("Telegram notification secrets missing"); return false; }
  try {
    const method = photoUrl ? "sendPhoto" : "sendMessage";
    const payload = photoUrl
      ? { chat_id: chat, photo: photoUrl, caption: text.slice(0, 1000) }
      : { chat_id: chat, text, disable_web_page_preview: true };
    const response = await fetch("https://api.telegram.org/bot" + bot + "/" + method, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(12000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok !== true) {
      console.error("Telegram notification failed", result?.description || response.status);
      return false;
    }
    return true;
  } catch (error) { console.error("Telegram notification error", error); return false; }
}


Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (req.method !== "POST") return out({ error: "Method not allowed" }, 405, origin);
  if (!ALLOWED.has(origin)) return out({ error: "Origin not allowed" }, 403, origin);

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!token || !url || !anon || !service) return out({ error: "نشست کاربری معتبر نیست." }, 401, origin);

    const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user?.id || !user.email) return out({ error: "برای ادامه وارد حساب کاربری شو." }, 401, origin);

    const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = user.email.trim().toLowerCase();
    const emailPattern = email.replace(/[\\%_]/g, "\\$&");
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "dashboard");


    if (["project_message","request_revision","submit_review"].includes(action)) {
      const projectId = String(body?.project_id || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(projectId)) return out({ error: "شناسه پروژه معتبر نیست." }, 400, origin);
      const { data: project, error: projectError } = await db.from("client_projects").select("id,title,status,client_name,client_email").eq("id", projectId).ilike("client_email", emailPattern).maybeSingle();
      if (projectError || !project || String(project.client_email || "").trim().toLowerCase() !== email) return out({ error: "این پروژه به حساب شما تعلق ندارد." }, 404, origin);
      if (action === "project_message") {
        const message = String(body?.message || "").trim();
        if (!message || message.length > 5000) return out({ error: "پیام باید بین ۱ تا ۵۰۰۰ نویسه باشد." }, 400, origin);
        const { error } = await db.from("project_messages").insert({ project_id: project.id, sender_type: "customer", message_body: message });
        if (error) throw error;
        const { error: ne } = await db.from("project_notifications").insert({ project_id: project.id, recipient_type: "admin", notification_type: "customer_message", title: "پیام جدید مشتری", body: project.title + " — " + message.slice(0,180) });
        if (ne) throw ne;
        await notifyTelegram("💬 پیام جدید مشتری | Alishams Studio\\n\\n👤 مشتری: " + String(project.client_name || "نامشخص") + "\\n📁 پروژه: " + project.title + "\\n📧 ایمیل: " + email + "\\n\\n📝 پیام:\\n" + message.slice(0,3000) + "\\n\\n🔗 پنل مدیریت پروژه‌ها: https://alishams.ir/admin-projects.html");
        return out({ ok: true }, 201, origin);
      }
      if (action === "request_revision") {
        const request = String(body?.request || "").trim();
        if (request.length < 5 || request.length > 5000) return out({ error: "توضیح اصلاح باید بین ۵ تا ۵۰۰۰ نویسه باشد." }, 400, origin);
        if (project.status !== "completed") return out({ error: "ثبت درخواست اصلاح پس از تکمیل پروژه امکان‌پذیر است." }, 409, origin);
        const { data: existing } = await db.from("project_revision_requests").select("id").eq("project_id", project.id).in("status", ["pending","in_review"]).limit(1);
        if (existing?.length) return out({ error: "برای این پروژه یک درخواست اصلاح در حال بررسی دارید." }, 409, origin);
        const { data, error } = await db.from("project_revision_requests").insert({ project_id: project.id, customer_email: email, request_body: request }).select("id").single();
        if (error) throw error;
        const { error: ne } = await db.from("project_notifications").insert({ project_id: project.id, recipient_type: "admin", notification_type: "revision_request", title: "درخواست اصلاح جدید", body: project.title + " — " + request.slice(0,180) });
        if (ne) throw ne;
        return out({ ok: true, request_id: data.id }, 201, origin);
      }
      if (action === "submit_review") {
        const rating = Number(body?.rating), review = String(body?.review || "").trim();
        if (project.status !== "completed") return out({ error: "امتیازدهی پس از تکمیل پروژه فعال می‌شود." }, 409, origin);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5 || review.length > 2000) return out({ error: "امتیاز یا متن دیدگاه معتبر نیست." }, 400, origin);
        const displayName = String(user.user_metadata?.full_name || project.client_name || "مشتری").trim().slice(0,120);
        const { error } = await db.from("project_reviews").upsert({ project_id: project.id, customer_email: email, display_name: displayName, rating, review_text: review, is_approved: false, is_featured: false, updated_at: new Date().toISOString() }, { onConflict: "project_id" });
        if (error) throw error;
        const { error: ne } = await db.from("project_notifications").insert({ project_id: project.id, recipient_type: "admin", notification_type: "project_review", title: "امتیاز جدید پروژه", body: project.title + " — " + rating + " از ۵" });
        if (ne) throw ne;
        return out({ ok: true, pending_approval: true }, 201, origin);
      }
    }
    if (action === "upload_payment_receipt") {
      const projectId = String(body?.project_id || "").trim();
      const mime = String(body?.mime_type || "").toLowerCase();
      const base64 = String(body?.image_base64 || "");
      const allowed = new Set(["image/jpeg","image/png","image/webp"]);
      if (!/^[0-9a-f-]{36}$/i.test(projectId) || !allowed.has(mime) || !base64 || base64.length > 7_000_000)
        return out({ error: "تصویر معتبر نیست. فقط JPG، PNG یا WebP تا حجم ۵ مگابایت پذیرفته می‌شود." }, 400, origin);
      const { data: project, error: projectError } = await db.from("client_projects").select("id,title,client_name,client_email").eq("id", projectId).ilike("client_email", emailPattern).maybeSingle();
      if (projectError || !project || String(project.client_email || "").trim().toLowerCase() !== email)
        return out({ error: "این پروژه به حساب شما تعلق ندارد." }, 404, origin);
      const raw = base64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
      let bytes: Uint8Array;
      try { const binary = atob(raw); bytes = new Uint8Array(binary.length); for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i); }
      catch { return out({ error: "خواندن تصویر انجام نشد." }, 400, origin); }
      if (!bytes.length || bytes.length > 5*1024*1024) return out({ error: "حجم تصویر باید حداکثر ۵ مگابایت باشد." }, 400, origin);
      const ext = mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "webp";
      const path = projectId + "/receipts/" + crypto.randomUUID() + "." + ext;
      const { error: uploadError } = await db.storage.from("project-deliverables").upload(path, bytes, { contentType: mime, upsert: false });
      if (uploadError) throw uploadError;
      const { data: file, error: insertError } = await db.from("project_files").insert({
        project_id: projectId, file_path: path, file_name: "رسید کارت‌به‌کارت." + ext,
        description: "رسید پرداخت کارت‌به‌کارت — در انتظار اعتبارسنجی مدیر",
        mime_type: mime, file_size: bytes.length, is_invoice: false, file_type: "upload"
      }).select("id,project_id,file_path,file_name,description,mime_type,file_size,is_invoice,created_at,file_type").single();
      if (insertError) { await db.storage.from("project-deliverables").remove([path]); throw insertError; }
      const { error: notifyError } = await db.from("project_notifications").insert({
        project_id: projectId, recipient_type: "admin", notification_type: "payment_receipt",
        title: "رسید کارت‌به‌کارت جدید", body: project.title + " — " + project.client_name + " یک تصویر رسید پرداخت ارسال کرده است."
      });
      if (notifyError) console.error("receipt notification", notifyError);
      const { data: signedReceipt, error: signedReceiptError } = await db.storage.from("project-deliverables").createSignedUrl(path, 86400);
      const receiptLink = !signedReceiptError && signedReceipt?.signedUrl ? "\\n🖼 مشاهده رسید (اعتبار ۲۴ ساعت): " + signedReceipt.signedUrl : "";
      await notifyTelegram("💳 رسید کارت‌به‌کارت جدید | Alishams Studio\\n\\n👤 مشتری: " + String(project.client_name || "نامشخص") + "\\n📁 پروژه: " + project.title + "\\n📧 ایمیل: " + email + "\\n🕒 وضعیت: در انتظار اعتبارسنجی مدیر" + receiptLink + "\\n\\n🔗 پنل مدیریت پروژه‌ها: https://alishams.ir/admin-projects.html");
      return out({ ok: true, file_id: file.id, created_at: file.created_at }, 201, origin);
    }

    if (action === "push_config") {
      const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
      return out({ ok: true, enabled: !!publicKey, public_key: publicKey }, 200, origin);
    }
    if (action === "save_push_subscription") {
      const sub = body?.subscription;
      const endpoint = String(sub?.endpoint || "");
      const p256dh = String(sub?.keys?.p256dh || "");
      const authSecret = String(sub?.keys?.auth || "");
      if (!endpoint.startsWith("https://") || endpoint.length > 2048 || !p256dh || !authSecret || p256dh.length > 256 || authSecret.length > 256)
        return out({ error: "اطلاعات اشتراک اعلان معتبر نیست." }, 400, origin);
      const { error } = await db.from("customer_push_subscriptions").upsert({
        user_id: user.id, email, endpoint, p256dh, auth_secret: authSecret,
        user_agent: String(req.headers.get("user-agent") || "").slice(0,500),
        updated_at: new Date().toISOString()
      }, { onConflict: "endpoint" });
      if (error) throw error;
      return out({ ok: true }, 201, origin);
    }
    if (action === "remove_push_subscription") {
      const endpoint = String(body?.endpoint || "");
      if (!endpoint.startsWith("https://")) return out({ error: "نشانی اشتراک معتبر نیست." }, 400, origin);
      const { error } = await db.from("customer_push_subscriptions").delete().eq("user_id", user.id).eq("endpoint", endpoint);
      if (error) throw error;
      return out({ ok: true }, 200, origin);
    }
    if (action === "mark_notification_read") {
      const ids = Array.isArray(body?.notification_ids) ? body.notification_ids.filter((x: any) => /^[0-9a-f-]{36}$/i.test(String(x))) : [];
      if (!ids.length || ids.length > 100) return out({ error: "اعلان معتبری انتخاب نشده است." }, 400, origin);
      const { data: ownedProjects, error: ownedError } = await db.from("client_projects").select("id").ilike("client_email", emailPattern);
      if (ownedError) throw ownedError;
      const ownedIds = (ownedProjects || []).map((p: any) => p.id);
      if (!ownedIds.length) return out({ ok: true }, 200, origin);
      const { error } = await db.from("project_notifications").update({ read_at: new Date().toISOString() }).in("id", ids).in("project_id", ownedIds).eq("recipient_type", "customer");
      if (error) throw error;
      return out({ ok: true }, 200, origin);
    }

    if (action === "download_project_file") {
      const fileId = String(body?.file_id || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(fileId)) return out({ error: "شناسه فایل معتبر نیست." }, 400, origin);
      const { data: file, error: fileError } = await db.from("project_files").select("id,project_id,file_path,file_name,file_type").eq("id", fileId).maybeSingle();
      if (fileError || !file) return out({ error: "فایل پیدا نشد." }, 404, origin);
      if ((file.file_type || "upload") !== "upload") return out({ error: "این مورد فایل دانلودی نیست." }, 400, origin);
      const { data: project, error: projectError } = await db.from("client_projects").select("id").eq("id", file.project_id).ilike("client_email", emailPattern).maybeSingle();
      if (projectError || !project) return out({ error: "دسترسی به این فایل مجاز نیست." }, 403, origin);
      const { data: signed, error: signedError } = await db.storage.from("project-deliverables").createSignedUrl(file.file_path, 120, { download: file.file_name });
      if (signedError || !signed?.signedUrl) return out({ error: "ساخت لینک دانلود انجام نشد." }, 500, origin);
      return out({ ok: true, signed_url: signed.signedUrl, file_name: file.file_name }, 200, origin);
    }

    if (action === "rotate_credential") {
      const itemType = String(body?.item_type || "");
      const trackingCode = String(body?.tracking_code || "").trim();
      if (!["order", "project", "conversation"].includes(itemType) || !trackingCode || trackingCode.length > 80)
        return out({ error: "نوع یا کد پیگیری معتبر نیست." }, 400, origin);

      const table = itemType === "order" ? "client_orders" : itemType === "project" ? "client_projects" : "communication_requests";
      const emailColumn = itemType === "conversation" ? "sender_email" : "client_email";
      const hashColumn = itemType === "project" ? "access_key_hash" : "access_token_hash";
      const { data: record, error: recordError } = await db.from(table)
        .select("id,tracking_code," + emailColumn).eq("tracking_code", trackingCode)
        .ilike(emailColumn, emailPattern).maybeSingle();
      if (recordError) {
        console.error("credential rotation lookup", recordError);
        return out({ error: "بررسی مورد پیگیری انجام نشد." }, 500, origin);
      }
      if (!record || String((record as any)[emailColumn] || "").trim().toLowerCase() !== email)
        return out({ error: "این مورد پیگیری به حساب شما تعلق ندارد." }, 404, origin);

      const privateKey = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x => x.toString(16).padStart(2, "0")).join("");
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(privateKey)))).map(x => x.toString(16).padStart(2, "0")).join("");
      const { error: vaultError } = await db.rpc("store_customer_tracking_credential", {
        p_owner_email: email, p_item_type: itemType, p_tracking_code: trackingCode,
        p_source_id: (record as any).id, p_private_key: privateKey
      });
      if (vaultError) {
        console.error("credential vault save", vaultError);
        return out({ error: "ذخیره کلید جدید انجام نشد؛ کلید قبلی همچنان معتبر است." }, 500, origin);
      }
      const { error: updateError } = await db.from(table).update({ [hashColumn]: hash }).eq("id", (record as any).id);
      if (updateError) {
        await db.from("customer_tracking_credentials").delete().eq("item_type", itemType).eq("tracking_code", trackingCode);
        console.error("credential rotation update", updateError);
        return out({ error: "صدور کلید جدید انجام نشد؛ کلید قبلی همچنان معتبر است." }, 500, origin);
      }
      return out({ ok: true, credential: { item_type: itemType, tracking_code: trackingCode, private_key: privateKey } }, 200, origin);
    }

    if (action === "reply") {
      const requestId = String(body?.request_id || "");
      const message = String(body?.message || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(requestId) || message.length < 1 || message.length > 5000)
        return out({ error: "متن پیام یا شناسه گفت‌وگو معتبر نیست." }, 400, origin);

      const { data: request, error: requestError } = await db.from("communication_requests")
        .select("id,sender_email,status").eq("id", requestId).ilike("sender_email", emailPattern).maybeSingle();
      if (requestError) {
        console.error("customer-account reply lookup", requestError);
        return out({ error: "بررسی گفت‌وگو انجام نشد." }, 500, origin);
      }
      if (!request || String(request.sender_email || "").trim().toLowerCase() !== email)
        return out({ error: "این گفت‌وگو به حساب شما تعلق ندارد." }, 404, origin);

      const { error: insertError } = await db.from("communication_messages")
        .insert({ request_id: request.id, sender_type: "visitor", message_body: message });
      if (insertError) {
        console.error("customer-account reply insert", insertError);
        return out({ error: "ارسال پیام انجام نشد. دوباره تلاش کن." }, 500, origin);
      }
      const { error: updateError } = await db.from("communication_requests")
        .update({ updated_at: new Date().toISOString(), status: request.status === "answered" ? "in_progress" : request.status })
        .eq("id", request.id);
      if (updateError) console.error("customer-account reply status update", updateError);
      await notifyTelegram("📨 پاسخ جدید در مرکز گفت‌وگو | Alishams Studio\\n\\n👤 ایمیل: " + email + "\\n🔎 کد پیگیری: " + String(requestId) + "\\n\\n💬 پیام:\\n" + message.slice(0,3000) + "\\n\\n🔗 مرکز مکاتبات: https://alishams.ir/contact-center.html");
      return out({ ok: true }, 201, origin);
    }

    if (action !== "dashboard") return out({ error: "عملیات ناشناخته است." }, 400, origin);

    const [ordersR, projectsR, requestsR] = await Promise.all([
      db.from("client_orders")
        .select("id,tracking_code,client_name,service,title,budget,status,quoted_price,discount_code,discount_percent,discount_amount,payable_amount,eta_date,public_message,project_id,created_at,updated_at")
        .ilike("client_email", emailPattern).order("created_at", { ascending: false }).limit(100),
      db.from("client_projects")
        .select("id,tracking_code,client_name,title,description,status,progress,total_price,created_at,updated_at,target_date")
        .ilike("client_email", emailPattern).order("updated_at", { ascending: false }).limit(100),
      db.from("communication_requests")
        .select("id,tracking_code,sender_name,sender_email,subject,category,status,created_at,updated_at")
        .ilike("sender_email", emailPattern).order("created_at", { ascending: false }).limit(100)
    ]);
    if (ordersR.error || projectsR.error || requestsR.error) {
      console.error("customer-account query", ordersR.error, projectsR.error, requestsR.error);
      return out({ error: "دریافت اطلاعات حساب انجام نشد. کمی بعد دوباره تلاش کن." }, 500, origin);
    }

    const orders = ordersR.data || [];
    const projects = projectsR.data || [];
    const requests = requestsR.data || [];
    const { data: credentialRows, error: credentialsError } = await db.rpc("list_customer_tracking_credentials", { p_owner_email: email });
    if (credentialsError) {
      console.error("customer-account credentials query", credentialsError);
      return out({ error: "دریافت کدها و کلیدهای پیگیری انجام نشد. کمی بعد دوباره تلاش کن." }, 500, origin);
    }
    const credentials = (credentialRows || []).map((c: any) => {
      const type = String(c.item_type || "");
      const code = String(c.tracking_code || "");
      const record = type === "order" ? orders.find((x: any) => x.tracking_code === code)
        : type === "project" ? projects.find((x: any) => x.tracking_code === code)
        : requests.find((x: any) => x.tracking_code === code);
      return { item_type: type, tracking_code: code, private_key: c.private_key || null,
        updated_at: c.updated_at || null,
        title: record ? (type === "conversation" ? record.subject : record.title) : (type === "order" ? "سفارش" : type === "project" ? "پروژه" : "گفت‌وگو") };
    });
    // Keep legacy records visible even when their private key was never stored.
    const known = new Set(credentials.map((c: any) => c.item_type + ":" + c.tracking_code));
    for (const [type, rows] of [["order", orders], ["project", projects], ["conversation", requests]] as any) {
      for (const row of rows) {
        const key = type + ":" + String(row.tracking_code || "");
        if (row.tracking_code && !known.has(key)) credentials.push({
          item_type: type, tracking_code: row.tracking_code, private_key: null,
          updated_at: row.updated_at || row.created_at || null,
          title: type === "conversation" ? row.subject : row.title
        });
      }
    }
    const requestIds = requests.map((r: any) => r.id);
    const orderIds = orders.map((r: any) => r.id);
    const projectIds = projects.map((r: any) => r.id);
    const [messagesR, eventsR, paymentsR, historyR, projectFilesR, projectMessagesR, notificationsR, revisionsR, reviewsR] = await Promise.all([
      requestIds.length ? db.from("communication_messages").select("id,request_id,sender_type,message_body,created_at").in("request_id", requestIds).order("created_at", { ascending: true }).limit(500) : Promise.resolve({ data: [], error: null }),
      orderIds.length ? db.from("client_order_events").select("id,order_id,status,public_message,created_at").in("order_id", orderIds).order("created_at", { ascending: false }).limit(500) : Promise.resolve({ data: [], error: null }),
      projectIds.length ? db.from("project_payments").select("id,project_id,amount,paid_at,method,note,confirmed").in("project_id", projectIds).order("paid_at", { ascending: false }).limit(500) : Promise.resolve({ data: [], error: null }),
      projectIds.length ? db.from("project_status_history").select("id,project_id,status,progress,note,created_at").in("project_id", projectIds).order("created_at", { ascending: false }).limit(500) : Promise.resolve({ data: [], error: null }),
      projectIds.length ? db.from("project_files").select("id,project_id,file_name,description,mime_type,file_size,is_invoice,created_at,file_type,content,external_url").in("project_id", projectIds).order("created_at", { ascending: false }).limit(500) : Promise.resolve({ data: [], error: null }),
      projectIds.length ? db.from("project_messages").select("id,project_id,sender_type,message_body,created_at").in("project_id", projectIds).order("created_at", { ascending: true }).limit(1000) : Promise.resolve({ data: [], error: null }),
      projectIds.length ? db.from("project_notifications").select("id,project_id,notification_type,title,body,read_at,created_at").in("project_id", projectIds).eq("recipient_type","customer").order("created_at", { ascending: false }).limit(300) : Promise.resolve({ data: [], error: null }),
      projectIds.length ? db.from("project_revision_requests").select("id,project_id,request_body,status,admin_response,created_at,updated_at").in("project_id", projectIds).order("created_at", { ascending: false }).limit(300) : Promise.resolve({ data: [], error: null }),
      projectIds.length ? db.from("project_reviews").select("id,project_id,rating,review_text,is_approved,created_at,updated_at").in("project_id", projectIds).limit(300) : Promise.resolve({ data: [], error: null })
    ]);
    if (messagesR.error || eventsR.error || paymentsR.error || historyR.error || projectFilesR.error || projectMessagesR.error || notificationsR.error || revisionsR.error || reviewsR.error) {
      console.error("customer-account detail query", messagesR.error, eventsR.error, paymentsR.error, historyR.error, projectFilesR.error, projectMessagesR.error, notificationsR.error, revisionsR.error, reviewsR.error);
      return out({ error: "دریافت تاریخچه جزئیات انجام نشد. کمی بعد دوباره تلاش کن." }, 500, origin);
    }

    const [refCodeR, refInvitesR, refRewardR] = await Promise.all([
      db.from("referral_codes").select("code").eq("user_id", user.id).maybeSingle(),
      db.from("referral_attributions").select("id,status,created_at,qualified_at").eq("referrer_user_id", user.id).order("created_at", { ascending: false }).limit(100),
      db.from("referral_rewards").select("discount_code,discount_percent,status,created_at,redeemed_at").eq("user_id", user.id).maybeSingle()
    ]);
    if (refCodeR.error || refInvitesR.error || refRewardR.error) {
      console.error("customer-account referral query", refCodeR.error, refInvitesR.error, refRewardR.error);
      return out({ error: "دریافت اطلاعات دعوت دوستان انجام نشد." }, 500, origin);
    }
    const referral = {
      code: refCodeR.data?.code || null,
      invitations: refInvitesR.data || [],
      reward: refRewardR.data || null
    };

    return out({
      ok: true,
      profile: { id: user.id, email: user.email, full_name: String(user.user_metadata?.full_name || ""), phone: String(user.user_metadata?.phone || "") },
      referral,
      orders, projects, requests, credentials,
      messages: messagesR.data || [],
      orderEvents: eventsR.data || [],
      payments: paymentsR.data || [],
      projectHistory: historyR.data || [],
      projectFiles: projectFilesR.data || [],
      projectMessages: projectMessagesR.data || [],
      notifications: notificationsR.data || [],
      revisionRequests: revisionsR.data || [],
      projectReviews: reviewsR.data || []
    }, 200, origin);
  } catch (error) {
    console.error("customer-account", error);
    return out({ error: "خطای غیرمنتظره رخ داد. دوباره تلاش کن." }, 500, origin);
  }
});