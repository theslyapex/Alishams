import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const DISPATCH_TOKEN = Deno.env.get("BALADI_PUSH_DISPATCH_TOKEN") || "";
const SERVICE_ACCOUNT_RAW = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") || "";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const FCM_TOKEN_URL = "https://oauth2.googleapis.com/token";

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

let cachedAccessToken = "";
let cachedAccessTokenUntil = 0;

function base64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function googleAccessToken(account: ServiceAccount): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedAccessTokenUntil - 60_000) return cachedAccessToken;
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({ iss: account.client_email, scope: FCM_SCOPE, aud: FCM_TOKEN_URL, iat: now, exp: now + 3600 }));
  const unsigned = header + "." + claim;
  const pem = account.private_key.replace(/\\n/g, "\n");
  const der = Uint8Array.from(atob(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const response = await fetch(FCM_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: unsigned + "." + base64Url(signature) })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error("دریافت مجوز ارسال اعلان از گوگل ناموفق بود.");
  cachedAccessToken = String(data.access_token);
  cachedAccessTokenUntil = Date.now() + Number(data.expires_in || 3600) * 1000;
  return cachedAccessToken;
}

function preferenceColumn(source: string, eventKey: string): string | null {
  if (source === "baladi_duel") return eventKey === "invite_received" ? "duel_invites" : "game_results";
  if (source === "baladi_group") return "group_leadership";
  if (source === "baladi_admin") return "admin_messages";
  if (source === "baladi_reward") return "rewards";
  return null;
}

async function sendToDevice(projectId: string, accessToken: string, deviceToken: string, item: Record<string, string>, prefs: { sound_enabled: boolean; vibration_enabled: boolean }) {
  const androidNotification: Record<string, unknown> = { channel_id: "baladi_updates", priority: "HIGH" };
  if (prefs.sound_enabled) androidNotification.sound = "default";
  if (prefs.vibration_enabled) androidNotification.default_vibrate_timings = true;
  const response = await fetch("https://fcm.googleapis.com/v1/projects/" + encodeURIComponent(projectId) + "/messages:send", {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        notification: { title: item.title, body: item.body },
        data: item,
        android: { priority: "HIGH", notification: androidNotification }
      }
    })
  });
  const result = await response.json().catch(() => ({}));
  if (response.ok) return { ok: true, messageId: String(result.name || "") };
  const errorText = JSON.stringify(result);
  return {
    ok: false,
    error: errorText.slice(0, 1200),
    unregistered: response.status === 404 || errorText.includes("UNREGISTERED") || errorText.includes("registration-token-not-registered")
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  if (!DISPATCH_TOKEN || (req.headers.get("x-baladi-push-token") || "") !== DISPATCH_TOKEN) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!URL || !SERVICE || !SERVICE_ACCOUNT_RAW) return Response.json({ error: "Push dispatcher is not configured." }, { status: 503 });

  try {
    const account = JSON.parse(SERVICE_ACCOUNT_RAW) as ServiceAccount;
    if (!account.project_id || !account.client_email || !account.private_key) throw new Error("Firebase service account JSON is incomplete.");
    const db = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
    const accessToken = await googleAccessToken(account);
    const { data: pending, error: pendingError } = await db.from("baladi_push_outbox")
      .select("id,notification_id,user_id,status,attempts")
      .in("status", ["pending", "failed"])
      .lt("attempts", 8)
      .order("created_at", { ascending: true })
      .limit(50);
    if (pendingError) throw pendingError;

    let sent = 0, skipped = 0, failed = 0, claimed = 0;
    for (const row of pending || []) {
      const { data: claim, error: claimError } = await db.from("baladi_push_outbox")
        .update({ status: "processing", attempts: Number(row.attempts || 0) + 1, last_error: "" })
        .eq("id", row.id)
        .in("status", ["pending", "failed"])
        .select("id")
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claim) continue;
      claimed++;

      const { data: item, error: itemError } = await db.from("account_notifications")
        .select("id,user_id,source,source_id,event_key,title,body")
        .eq("id", row.notification_id)
        .maybeSingle();
      if (itemError) throw itemError;
      if (!item) {
        await db.from("baladi_push_outbox").update({ status: "skipped", processed_at: new Date().toISOString(), last_error: "Notification no longer exists." }).eq("id", row.id);
        skipped++;
        continue;
      }

      const preference = preferenceColumn(String(item.source || ""), String(item.event_key || ""));
      if (!preference) {
        await db.from("baladi_push_outbox").update({ status: "skipped", processed_at: new Date().toISOString(), last_error: "Not a Baladi push notification." }).eq("id", row.id);
        skipped++;
        continue;
      }
      const { data: prefs } = await db.from("baladi_notification_preferences")
        .select("game_results,duel_invites,group_leadership,admin_messages,rewards,sound_enabled,vibration_enabled")
        .eq("user_id", row.user_id).maybeSingle();
      if (prefs && prefs[preference] === false) {
        await db.from("baladi_push_outbox").update({ status: "skipped", processed_at: new Date().toISOString(), last_error: "Disabled by notification preferences." }).eq("id", row.id);
        skipped++;
        continue;
      }
      const { data: devices, error: deviceError } = await db.from("baladi_device_tokens")
        .select("id,fcm_token").eq("user_id", row.user_id).eq("enabled", true);
      if (deviceError) throw deviceError;
      if (!devices?.length) {
        await db.from("baladi_push_outbox").update({ status: "skipped", processed_at: new Date().toISOString(), last_error: "No active device tokens." }).eq("id", row.id);
        skipped++;
        continue;
      }

      let deviceSent = 0;
      const messageIds: string[] = [];
      const errors: string[] = [];
      const payload = {
        notification_id: String(item.id), source: String(item.source || ""), event_key: String(item.event_key || ""),
        source_id: String(item.source_id || ""), title: String(item.title || "اعلان جدید در بلدی؟"), body: String(item.body || "")
      };
      for (const device of devices) {
        const result = await sendToDevice(account.project_id, accessToken, String(device.fcm_token), payload, {
          sound_enabled: prefs?.sound_enabled !== false,
          vibration_enabled: prefs?.vibration_enabled !== false
        });
        if (result.ok) {
          deviceSent++;
          if (result.messageId) messageIds.push(result.messageId);
        } else {
          errors.push(result.error || "FCM send failed.");
          if (result.unregistered) await db.from("baladi_device_tokens").delete().eq("id", device.id);
        }
      }
      const status = deviceSent === devices.length ? "sent" : deviceSent > 0 ? "partial" : "failed";
      await db.from("baladi_push_outbox").update({
        status,
        processed_at: status === "failed" ? null : new Date().toISOString(),
        last_error: errors.join("\n").slice(0, 4000),
        provider_message_ids: messageIds
      }).eq("id", row.id);
      if (status === "sent" || status === "partial") sent++;
      else failed++;
    }
    return Response.json({ ok: true, claimed, sent, skipped, failed });
  } catch (error) {
    console.error("Baladi push dispatch failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Push dispatch failed." }, { status: 500 });
  }
});
