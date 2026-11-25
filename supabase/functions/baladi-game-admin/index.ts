import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OWNER = "theslyapex@gmail.com";
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
const uuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ""));

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (req.method !== "POST") return out({ error: "Method not allowed" }, 405, origin);
  if (origin && !ALLOWED.has(origin)) return out({ error: "Origin not allowed" }, 403, origin);
  try {
    if (!URL || !ANON || !SERVICE) return out({ error: "سرویس مدیریت بازی در دسترس نیست." }, 503, origin);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\\s+/i, "");
    if (!token) return out({ error: "ورود مدیر الزامی است." }, 401, origin);
    const auth = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    if (authError || authData.user?.email?.toLowerCase() !== OWNER)
      return out({ error: "دسترسی فقط برای مدیر اصلی مجاز است." }, 403, origin);
    const db = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "users_list") {
      const page = Math.max(1, Math.min(20, Number(body.page) || 1));
      const [{ data: authUsers, error: authListError }, { data: profiles, error: profileError }] = await Promise.all([
        db.auth.admin.listUsers({ page, perPage: 1000 }),
        db.from("baladi_game_profiles").select("user_id,display_name,player_tag,coins,diamonds,current_level,levels_completed,words_found,wins,losses,last_played_at,created_at,is_suspended,suspension_reason").order("last_played_at", { ascending: false, nullsFirst: false }).limit(1000)
      ]);
      if (authListError) throw authListError;
      if (profileError) throw profileError;
      const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));
      const users = (authUsers.users || []).map((u: any) => ({
        id: u.id, email: u.email || "", created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at, banned_until: u.banned_until,
        profile: profileMap.get(u.id) || null
      })).filter((u: any) => u.profile !== null);
      return out({ ok: true, users, page, total: authUsers.users?.length || 0 }, 200, origin);
    }

    if (action === "adjust_coins") {
      const userId = String(body.user_id || "");
      const delta = Number(body.delta);
      const reason = String(body.reason || "").trim().slice(0, 500);
      if (!uuid(userId) || !Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 10000000)
        return out({ error: "شناسه یا مقدار سکه معتبر نیست." }, 400, origin);
      const { data, error } = await db.rpc("baladi_admin_adjust_coins", { p_user_id: userId, p_delta: delta, p_reason: reason });
      if (error) return out({ error: error.message || "تغییر موجودی انجام نشد." }, 409, origin);
      return out({ ok: true, result: data }, 200, origin);
    }

    if (action === "send_notification") {
      const userId = String(body.user_id || "");
      const title = String(body.title || "").trim().slice(0, 100);
      const message = String(body.message || "").trim().slice(0, 1500);
      if (!uuid(userId) || title.length < 2 || !message)
        return out({ error: "عنوان و متن پیام معتبر نیست." }, 400, origin);
      const { data, error } = await db.from("account_notifications").insert({
        user_id: userId, source: "baladi_admin", source_id: "manual",
        event_key: "admin_" + crypto.randomUUID(), title, body: message
      }).select("id,title,body,created_at").single();
      if (error) throw error;
      return out({ ok: true, notification: data }, 201, origin);
    }

    if (action === "block_user" || action === "unblock_user") {
      const userId = String(body.user_id || "");
      if (!uuid(userId)) return out({ error: "شناسه کاربر معتبر نیست." }, 400, origin);
      const suspended = action === "block_user";
      const reason = String(body.reason || "").trim().slice(0, 500);
      const { data, error } = await db.from("baladi_game_profiles").update({
        is_suspended: suspended, suspension_reason: suspended ? reason : "",
        updated_at: new Date().toISOString()
      }).eq("user_id", userId).select("user_id,is_suspended,suspension_reason").single();
      if (error) throw error;
      return out({ ok: true, profile: data }, 200, origin);
    }

    if (action === "delete_game_account") {
      const userId = String(body.user_id || "");
      if (!uuid(userId) || body.confirm !== "DELETE")
        return out({ error: "برای حذف حساب بازی، تأیید صریح لازم است." }, 400, origin);
      const { data, error } = await db.rpc("baladi_delete_game_account", { p_user_id: userId });
      if (error) throw error;
      return out({ ok: true, deleted: true, website_account_retained: true, result: data }, 200, origin);
    }

    if (action === "groups_list") {
      const { data: groups, error } = await db.from("baladi_groups")
        .select("id,name,description,leader_id,capacity,group_level,upgrade_progress,created_at")
        .order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      const ids = (groups || []).map((g: any) => g.id);
      const { data: members, error: membersError } = ids.length
        ? await db.from("baladi_group_members").select("group_id,user_id,role,joined_at").in("group_id", ids)
        : { data: [], error: null };
      if (membersError) throw membersError;
      const counts = new Map<string, number>();
      for (const m of members || []) counts.set(m.group_id, (counts.get(m.group_id) || 0) + 1);
      const userIds = [...new Set((groups || []).map((g: any) => g.leader_id))];
      const { data: leaders, error: leadersError } = userIds.length
        ? await db.from("baladi_game_profiles").select("user_id,display_name,player_tag").in("user_id", userIds)
        : { data: [], error: null };
      if (leadersError) throw leadersError;
      const leaderMap = new Map((leaders || []).map((p: any) => [p.user_id, p]));
      return out({ ok: true, groups: (groups || []).map((g: any) => ({
        ...g, member_count: counts.get(g.id) || 0,
        leader: leaderMap.get(g.leader_id) || { display_name: "بازیکن" }
      })) }, 200, origin);
    }

    if (action === "group_messages") {
      const groupId = String(body.group_id || "");
      if (!uuid(groupId)) return out({ error: "شناسه گروه معتبر نیست." }, 400, origin);
      const { data: messages, error } = await db.from("baladi_group_messages")
        .select("id,group_id,user_id,body,sticker_id,is_pinned,pinned_at,created_at")
        .eq("group_id", groupId).order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      const userIds = [...new Set((messages || []).map((m: any) => m.user_id))];
      const stickerIds = [...new Set((messages || []).map((m: any) => m.sticker_id).filter(Boolean))];
      const [{ data: profiles, error: profilesError }, { data: stickers, error: stickersError }] = await Promise.all([
        userIds.length ? db.from("baladi_game_profiles").select("user_id,display_name,player_tag").in("user_id", userIds) : Promise.resolve({ data: [], error: null }),
        stickerIds.length ? db.from("baladi_cosmetic_catalog").select("id,display_name,asset_path").in("id", stickerIds) : Promise.resolve({ data: [], error: null })
      ]);
      if (profilesError) throw profilesError;
      if (stickersError) throw stickersError;
      const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));
      const stickerMap = new Map((stickers || []).map((p: any) => [p.id, p]));
      return out({ ok: true, messages: (messages || []).reverse().map((m: any) => ({
        ...m, player: profileMap.get(m.user_id) || { display_name: "بازیکن" },
        sticker: m.sticker_id ? stickerMap.get(m.sticker_id) || null : null
      })) }, 200, origin);
    }

    if (action === "leaderboard") {
      const { data, error } = await db.from("baladi_game_profiles")
        .select("user_id,display_name,player_tag,coins,diamonds,current_level,levels_completed,words_found,wins,losses,last_played_at")
        .order("levels_completed", { ascending: false })
        .order("wins", { ascending: false })
        .order("words_found", { ascending: false }).limit(100);
      if (error) throw error;
      return out({ ok: true, players: data || [] }, 200, origin);
    }

    return out({ error: "عملیات ناشناخته است." }, 400, origin);
  } catch (error) {
    console.error("baladi-game-admin error", error);
    return out({ error: "ارتباط با مدیریت بازی ناموفق بود." }, 500, origin);
  }
});