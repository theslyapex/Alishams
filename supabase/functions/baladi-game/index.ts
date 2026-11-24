import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ALLOWED = new Set(["https://alishams.ir", "https://www.alishams.ir"]);
const headers = (origin: string) => ({
  "Access-Control-Allow-Origin": ALLOWED.has(origin) ? origin : "https://alishams.ir",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-baladi-monthly-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
});
const out = (body: unknown, status: number, origin: string) =>
  new Response(JSON.stringify(body), { status, headers: headers(origin) });

function jalaliMonthWindow(date: Date) {
  const persian = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
    timeZone: "Asia/Tehran", year: "numeric", month: "numeric", day: "numeric"
  });
  const gregorian = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit"
  });
  const parts = (formatter: Intl.DateTimeFormat, value: Date) =>
    Object.fromEntries(formatter.formatToParts(value).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const jp = parts(persian, date);
  const gp = parts(gregorian, date);
  const localMidnightUtc = Date.UTC(Number(gp.year), Number(gp.month) - 1, Number(gp.day)) - 210 * 60 * 1000;
  const start = new Date(localMidnightUtc - (Number(jp.day) - 1) * 86400000);
  return { key: String(jp.year) + "-" + String(jp.month).padStart(2, "0"), day: Number(jp.day), start };
}

const uuid = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (req.method !== "POST") return out({ error: "Method not allowed" }, 405, origin);
  if (origin && !ALLOWED.has(origin)) return out({ error: "Origin not allowed" }, 403, origin);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "summary");

    if (action === "monthly_cron") {
      if (!URL || !SERVICE) return out({ error: "Monthly scheduler unavailable." }, 503, origin);
      const cronToken = req.headers.get("x-baladi-monthly-token") || "";
      const dbCron = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
      const verified = await dbCron.rpc("baladi_validate_monthly_cron_token", { p_token: cronToken });
      if (verified.error || verified.data !== true) return out({ error: "Unauthorized scheduler request." }, 401, origin);
      const now = new Date();
      const currentMonth = jalaliMonthWindow(now);
      if (currentMonth.day !== 1) return out({ ok: true, skipped: true, jalali_day: currentMonth.day }, 200, origin);
      const previousMonth = jalaliMonthWindow(new Date(currentMonth.start.getTime() - 1));
      const finalized = await dbCron.rpc("baladi_finalize_monthly_leaderboard", {
        p_month_key: previousMonth.key,
        p_start_at: previousMonth.start.toISOString(),
        p_end_at: currentMonth.start.toISOString()
      });
      if (finalized.error) throw finalized.error;
      return out({ ok: true, month_closed: previousMonth.key, result: finalized.data }, 200, origin);
    }

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token || !URL || !ANON || !SERVICE) return out({ error: "نشست کاربری معتبر نیست." }, 401, origin);

    const auth = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user?.id || !user.email) return out({ error: "برای استفاده از بازی وارد حساب کاربری سایت شو." }, 401, origin);

    const db = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

    if (action === "summary") {
      const { error: ensureError } = await db.from("baladi_game_profiles")
        .upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });
      if (ensureError) throw ensureError;
      const { data: profile, error } = await db.from("baladi_game_profiles")
        .select("coins,current_level,completed_levels,levels_completed,total_play_seconds,sessions_count,words_found,bonus_words_found,hints_used,last_played_at,created_at,display_name,daily_streak,last_checkin_date,avatar_path,avatar_unlocked,equipped_frame_id,wins,losses,chat_unlocked_at,diamonds,name_change_count,is_verified")
        .eq("user_id", user.id).single();
      if (error) throw error;

      // Backfill an empty game display name from the identity provider metadata.
      // Never overwrite a name that the player has chosen inside the game.
      const userMetadata = user.user_metadata || {};
      const metadataName = String(
        userMetadata.full_name || userMetadata.name ||
        userMetadata.nickname || userMetadata.preferred_username || ""
      ).trim().normalize("NFC");
      if ((!profile.display_name || !String(profile.display_name).trim()) &&
          metadataName.length >= 2 && metadataName.length <= 24) {
        const { data: updatedProfile, error: nameError } = await db.from("baladi_game_profiles")
          .update({ display_name: metadataName, updated_at: new Date().toISOString() })
          .eq("user_id", user.id)
          .select("coins,current_level,completed_levels,levels_completed,total_play_seconds,sessions_count,words_found,bonus_words_found,hints_used,last_played_at,created_at,display_name,daily_streak,last_checkin_date,avatar_path,avatar_unlocked,equipped_frame_id,wins,losses,chat_unlocked_at,diamonds,name_change_count,is_verified")
          .single();
        if (nameError) throw nameError;
        Object.assign(profile, updatedProfile);
      }
      const { data: sessions, error: sessionError } = await db.from("baladi_game_sessions")
        .select("id,started_at,ended_at,duration_seconds,start_level,end_level,device_platform")
        .eq("user_id", user.id).order("started_at", { ascending: false }).limit(10);
      if (sessionError) throw sessionError;
      const { data: coinHistory, error: historyError } = await db.from("baladi_game_events")
        .select("id,event_type,level_number,coin_delta,created_at,metadata")
        .eq("user_id", user.id).neq("coin_delta", 0)
        .order("created_at", { ascending: false }).limit(15);
      if (historyError) throw historyError;
      return out({ ok: true, profile, sessions: sessions || [], coin_history: coinHistory || [] }, 200, origin);
    }

    if (action === "update_profile") {
      const displayName = String(body?.display_name || "").trim().normalize("NFC");
      if (displayName.length < 2 || displayName.length > 24 || /[\\u0000-\\u001f]/.test(displayName)) {
        return out({ error: "نام نمایشی باید بین ۲ تا ۲۴ نویسه باشد." }, 400, origin);
      }
      const { data, error } = await db.rpc("baladi_change_display_name", {
        p_user_id: user.id, p_display_name: displayName
      });
      if (error) return out({ error: error.message || "تغییر نام انجام نشد." }, 409, origin);
      return out({ ok: true, profile: data?.profile || null, diamonds_spent: Number(data?.diamonds_spent || 0) }, 200, origin);
    }

    if (action === "delete_account") {
      if (body?.confirm !== true) return out({ error: "برای حذف اطلاعات بازی باید تأیید کنی." }, 400, origin);
      const { data: deletion, error: deletionError } = await db.rpc("baladi_delete_game_account", { p_user_id: user.id });
      if (deletionError) throw deletionError;
      let avatarCleanupPending = false;
      for (let batch = 0; batch < 20; batch++) {
        const { data: avatarFiles, error: listError } = await db.storage.from("baladi-avatars")
          .list(user.id, { limit: 100 });
        if (listError) { avatarCleanupPending = true; break; }
        if (!avatarFiles?.length) break;
        const { error: removeError } = await db.storage.from("baladi-avatars")
          .remove(avatarFiles.map((file: any) => user.id + "/" + file.name));
        if (removeError) { avatarCleanupPending = true; break; }
        if (avatarFiles.length < 100) break;
      }
      return out({
        ok: true, game_account_deleted: true, website_account_retained: true,
        avatar_cleanup_pending: avatarCleanupPending,
        groups_transferred: Number(deletion?.groups_transferred || 0),
        groups_removed: Number(deletion?.groups_removed || 0)
      }, 200, origin);
    }
    if (action === "daily_checkin") {
      const { data, error } = await db.rpc("baladi_daily_checkin", { p_user_id: user.id });
      if (error) throw error;
      return out({
        ok: true,
        profile: data?.profile || null,
        reward: Number(data?.reward || 0),
        already_checked_in: Boolean(data?.already_checked_in),
        streak_day: Number(data?.streak_day || data?.profile?.daily_streak || 0),
        cycle_day: Number(data?.cycle_day || 0),
        next_reward: Number(data?.next_reward || 0)
      }, 200, origin);
    }

    if (action === "hint_clue") {
      const sessionId = body?.session_id;
      const level = Number(body?.level);
      const hintType = String(body?.hint_type || "");
      if (!uuid(sessionId) || !Number.isInteger(level) || level < 1) {
        return out({ error: "اطلاعات راهنما معتبر نیست." }, 400, origin);
      }
      const clueKey = String(body?.clue_key || "");
      const { data, error } = await db.rpc("baladi_spend_clue", {
        p_user_id: user.id,
        p_session_id: sessionId,
        p_level: level,
        p_hint_type: hintType,
        p_clue_key: clueKey
      });
      if (error) return out({ error: error.message || "مصرف سکه برای راهنما انجام نشد." }, 409, origin);
      return out({ ok: true, profile: data?.profile || null, cost: Number(data?.cost || 0), hint_type: hintType }, 200, origin);
    }

    if (action === "unlock_global_chat") {
      const { data, error } = await db.rpc("baladi_unlock_global_chat", { p_user_id: user.id });
      if (error) return out({ error: error.message || "بازکردن چت انجام نشد." }, 409, origin);
      return out({ ok: true, profile: data?.profile || null, cost: Number(data?.cost || 0), already_unlocked: Boolean(data?.already_unlocked) }, 200, origin);
    }

    if (action === "global_chat_list") {
      const { data: chatProfile, error: chatProfileError } = await db.from("baladi_game_profiles")
        .select("chat_unlocked_at").eq("user_id", user.id).single();
      if (chatProfileError) throw chatProfileError;
      if (!chatProfile.chat_unlocked_at) return out({ error: "برای مشاهده چت عمومی، ابتدا آن را با ۵۰۰۰ سکه باز کن." }, 403, origin);
      const { data: messages, error } = await db.from("baladi_global_chat_messages")
        .select("id,user_id,body,sticker_id,created_at")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const userIds = [...new Set((messages || []).map((message: any) => message.user_id))];
      const { data: profiles, error: profilesError } = userIds.length
        ? await db.from("baladi_game_profiles").select("user_id,display_name,avatar_path,equipped_frame_id,current_level,is_verified").in("user_id", userIds)
        : { data: [], error: null };
      if (profilesError) throw profilesError;
      const profileMap = new Map((profiles || []).map((profile: any) => [profile.user_id, profile]));
      const rows = (messages || []).reverse().map((message: any) => ({
        ...message,
        player: profileMap.get(message.user_id) || { display_name: "بازیکن" }
      }));
      return out({ ok: true, messages: rows }, 200, origin);
    }

    if (action === "report_global_chat_message") {
      const messageId = Number(body?.message_id || 0);
      const reason = String(body?.reason || "");
      if (!Number.isSafeInteger(messageId) || messageId <= 0)
        return out({ error: "شناسه پیام معتبر نیست." }, 400, origin);
      const { data, error } = await db.rpc("baladi_report_global_chat_message", {
        p_user_id: user.id, p_message_id: messageId, p_reason: reason
      });
      if (error) return out({ error: error.message || "ثبت گزارش انجام نشد." }, 409, origin);
      return out({ ok: true, result: data }, 201, origin);
    }

    if (action === "global_chat_send") {
      const bodyText = body?.sticker_id ? null : String(body?.body || "");
      const stickerId = body?.sticker_id ? String(body.sticker_id) : null;
      if (bodyText !== null && (bodyText.trim().length < 1 || bodyText.length > 350))
        return out({ error: "پیام باید بین ۱ تا ۳۵۰ نویسه باشد." }, 400, origin);
      const { data, error } = await db.rpc("baladi_send_global_message", {
        p_user_id: user.id, p_body: bodyText, p_sticker_id: stickerId
      });
      if (error) return out({ error: error.message || "ارسال پیام انجام نشد." }, 409, origin);
      return out({ ok: true, message: data }, 201, origin);
    }

    if (action === "cosmetics_catalog") {
      const { data: catalog, error: catalogError } = await db.from("baladi_cosmetic_catalog")
        .select("id,kind,display_name,price_coins,asset_path,sort_order")
        .eq("is_active", true).order("sort_order", { ascending: true });
      if (catalogError) throw catalogError;
      const { data: owned, error: ownedError } = await db.from("baladi_user_cosmetics")
        .select("cosmetic_id,purchased_at").eq("user_id", user.id);
      if (ownedError) throw ownedError;
      return out({ ok: true, catalog: catalog || [], owned: owned || [] }, 200, origin);
    }

    if (action === "purchase_cosmetic") {
      const cosmeticId = String(body?.cosmetic_id || "");
      if (!/^[a-z0-9_]{3,48}$/.test(cosmeticId))
        return out({ error: "شناسه کالا معتبر نیست." }, 400, origin);
      const { data, error } = await db.rpc("baladi_purchase_cosmetic", {
        p_user_id: user.id, p_cosmetic_id: cosmeticId
      });
      if (error) return out({ error: error.message || "خرید انجام نشد." }, 409, origin);
      return out({ ok: true, profile: data?.profile || null, item: data?.item || null }, 200, origin);
    }

    if (action === "equip_frame") {
      const frameId = String(body?.frame_id || "");
      if (!/^[a-z0-9_]{3,48}$/.test(frameId))
        return out({ error: "شناسه قاب معتبر نیست." }, 400, origin);
      const { data, error } = await db.rpc("baladi_equip_frame", {
        p_user_id: user.id, p_frame_id: frameId
      });
      if (error) return out({ error: error.message || "تغییر قاب انجام نشد." }, 409, origin);
      return out({ ok: true, profile: data }, 200, origin);
    }

    if (action === "set_avatar_path") {
      const avatarPath = String(body?.avatar_path || "");
      const prefix = user.id + "/avatar_";
      if (!avatarPath.startsWith(prefix) || !/^[0-9a-f-]{36}\/avatar_[A-Za-z0-9_-]{8,64}\.(jpg|jpeg|png|webp)$/i.test(avatarPath))
        return out({ error: "مسیر تصویر پروفایل معتبر نیست." }, 400, origin);
      const { data: profileBefore, error: profileBeforeError } = await db.from("baladi_game_profiles")
        .select("avatar_unlocked").eq("user_id", user.id).single();
      if (profileBeforeError) throw profileBeforeError;
      if (!profileBefore.avatar_unlocked) return out({ error: "برای فعال‌سازی تصویر پروفایل ابتدا ۷۰۰۰ سکه پرداخت کن." }, 403, origin);
      const fileName = avatarPath.split("/").pop() || "";
      const { data: files, error: storageError } = await db.storage.from("baladi-avatars")
        .list(user.id, { search: fileName, limit: 10 });
      if (storageError) throw storageError;
      if (!(files || []).some((file: any) => file.name === fileName))
        return out({ error: "تصویر بارگذاری‌شده پیدا نشد." }, 404, origin);
      const { data: profile, error } = await db.from("baladi_game_profiles")
        .update({ avatar_path: avatarPath, updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .select("user_id,display_name,avatar_path,equipped_frame_id,avatar_unlocked,coins")
        .single();
      if (error) throw error;
      return out({ ok: true, profile }, 200, origin);
    }

    if (action === "leaderboard") {
      const now = new Date();
      const currentMonth = jalaliMonthWindow(now);
      const previousMonth = jalaliMonthWindow(new Date(currentMonth.start.getTime() - 1));
      const finalized = await db.rpc("baladi_finalize_monthly_leaderboard", {
        p_month_key: previousMonth.key,
        p_start_at: previousMonth.start.toISOString(),
        p_end_at: currentMonth.start.toISOString()
      });
      if (finalized.error) throw finalized.error;

      const monthly = await db.rpc("baladi_monthly_stats", {
        p_start_at: currentMonth.start.toISOString(),
        p_end_at: now.toISOString(),
        p_limit: 100
      });
      if (monthly.error) throw monthly.error;

      const { data: previousWinners, error: winnersError } = await db.from("baladi_monthly_leaderboard")
        .select("rank,user_id,display_name,valid_words,highest_level,coins_earned,duel_wins,reward_coins")
        .eq("month_key", previousMonth.key).lte("rank", 3).order("rank", { ascending: true });
      if (winnersError) throw winnersError;

      const { data, error } = await db.from("baladi_game_profiles")
        .select("user_id,display_name,current_level,coins,wins,losses,avatar_path,equipped_frame_id,is_verified")
        .order("current_level", { ascending: false })
        .order("coins", { ascending: false })
        .order("wins", { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = (data || []).map((item: any, index: number) => ({ rank: index + 1, ...item }));
      return out({
        ok: true,
        leaderboard: rows,
        monthly_leaderboard: monthly.data?.leaderboard || [],
        monthly_month_key: currentMonth.key,
        previous_month_key: previousMonth.key,
        previous_month_winners: previousWinners || [],
        previous_month_finalization: finalized.data || {}
      }, 200, origin);
    }

    if (action === "public_profile") {
      const targetId = String(body?.user_id || "");
      if (!uuid(targetId)) return out({ error: "شناسه بازیکن معتبر نیست." }, 400, origin);
      const { data: profile, error } = await db.from("baladi_game_profiles")
        .select("user_id,display_name,current_level,levels_completed,total_play_seconds,sessions_count,words_found,bonus_words_found,wins,losses,avatar_path,equipped_frame_id,created_at,is_verified")
        .eq("user_id", targetId).maybeSingle();
      if (error) throw error;
      if (!profile) return out({ error: "پروفایل بازیکن پیدا نشد." }, 404, origin);
      return out({ ok: true, profile }, 200, origin);
    }

    if (action === "groups_list") {
      const { data: groups, error } = await db.from("baladi_groups")
        .select("id,name,description,leader_id,capacity,created_at")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      const ids = (groups || []).map((group: any) => group.id);
      const { data: members, error: memberError } = ids.length
        ? await db.from("baladi_group_members").select("group_id,user_id,role").in("group_id", ids)
        : { data: [], error: null };
      if (memberError) throw memberError;
      const memberCounts = new Map<string, number>();
      for (const member of members || []) memberCounts.set(member.group_id, (memberCounts.get(member.group_id) || 0) + 1);
      const leaderIds = [...new Set((groups || []).map((group: any) => group.leader_id))];
      const { data: leaders, error: leaderError } = leaderIds.length
        ? await db.from("baladi_game_profiles").select("user_id,display_name,is_verified").in("user_id", leaderIds)
        : { data: [], error: null };
      if (leaderError) throw leaderError;
      const leaderMap = new Map((leaders || []).map((profile: any) => [profile.user_id, profile]));
      return out({ ok: true, groups: (groups || []).map((group: any) => ({
        ...group, member_count: memberCounts.get(group.id) || 0,
        leader_name: leaderMap.get(group.leader_id)?.display_name || "بازیکن",
        leader_is_verified: Boolean(leaderMap.get(group.leader_id)?.is_verified)
      })) }, 200, origin);
    }

    if (action === "my_group") {
      const { data: membership, error } = await db.from("baladi_group_members")
        .select("group_id,role,joined_at").eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      if (!membership) return out({ ok: true, group: null, members: [] }, 200, origin);
      const { data: group, error: groupError } = await db.from("baladi_groups")
        .select("id,name,description,leader_id,capacity,created_at").eq("id", membership.group_id).single();
      if (groupError) throw groupError;
      const { data: members, error: membersError } = await db.from("baladi_group_members")
        .select("user_id,role,joined_at").eq("group_id", membership.group_id).order("joined_at", { ascending: true });
      if (membersError) throw membersError;
      const ids = (members || []).map((member: any) => member.user_id);
      const { data: profiles, error: profilesError } = ids.length
        ? await db.from("baladi_game_profiles").select("user_id,display_name,current_level,avatar_path,equipped_frame_id,wins,losses,is_verified").in("user_id", ids)
        : { data: [], error: null };
      if (profilesError) throw profilesError;
      const profileMap = new Map((profiles || []).map((profile: any) => [profile.user_id, profile]));
      return out({ ok: true, group: { ...group, my_role: membership.role }, members: (members || []).map((member: any) => ({ ...member, player: profileMap.get(member.user_id) || { display_name: "بازیکن" } })) }, 200, origin);
    }

    if (action === "create_group") {
      const name = String(body?.name || "").trim();
      const description = String(body?.description || "").trim();
      if (name.length < 3 || name.length > 28) return out({ error: "نام گروه باید بین ۳ تا ۲۸ نویسه باشد." }, 400, origin);
      const { data, error } = await db.rpc("baladi_create_group", { p_user_id: user.id, p_name: name, p_description: description });
      if (error) return out({ error: error.message || "ساخت گروه انجام نشد." }, 409, origin);
      return out({ ok: true, ...data }, 201, origin);
    }

    if (action === "join_group") {
      const groupId = String(body?.group_id || "");
      if (!uuid(groupId)) return out({ error: "شناسه گروه معتبر نیست." }, 400, origin);
      const { data, error } = await db.rpc("baladi_join_group", { p_user_id: user.id, p_group_id: groupId });
      if (error) return out({ error: error.message || "عضویت در گروه انجام نشد." }, 409, origin);
      return out({ ok: true, ...data }, 200, origin);
    }

    if (action === "upgrade_group_capacity") {
      const groupId = String(body?.group_id || "");
      const capacity = Number(body?.new_capacity || 0);
      if (!uuid(groupId) || !Number.isInteger(capacity)) return out({ error: "اطلاعات افزایش ظرفیت معتبر نیست." }, 400, origin);
      const { data, error } = await db.rpc("baladi_upgrade_group_capacity", { p_user_id: user.id, p_group_id: groupId, p_new_capacity: capacity });
      if (error) return out({ error: error.message || "افزایش ظرفیت انجام نشد." }, 409, origin);
      return out({ ok: true, ...data }, 200, origin);
    }

    if (action === "set_group_role") {
      const groupId = String(body?.group_id || "");
      const targetId = String(body?.target_user_id || "");
      const role = String(body?.role || "");
      if (!uuid(groupId) || !uuid(targetId)) return out({ error: "شناسه بازیکن یا گروه معتبر نیست." }, 400, origin);
      const { data, error } = await db.rpc("baladi_set_group_role", { p_actor_id: user.id, p_group_id: groupId, p_target_id: targetId, p_role: role });
      if (error) return out({ error: error.message || "تغییر مقام انجام نشد." }, 409, origin);
      return out({ ok: true, result: data }, 200, origin);
    }

    if (action === "remove_group_member") {
      const groupId = String(body?.group_id || "");
      const targetId = String(body?.target_user_id || "");
      if (!uuid(groupId) || !uuid(targetId)) return out({ error: "شناسه بازیکن یا گروه معتبر نیست." }, 400, origin);
      const { data, error } = await db.rpc("baladi_remove_group_member", { p_actor_id: user.id, p_group_id: groupId, p_target_id: targetId });
      if (error) return out({ error: error.message || "حذف عضو انجام نشد." }, 409, origin);
      return out({ ok: true, result: data }, 200, origin);
    }

    if (action === "transfer_group_leadership") {
      const groupId = String(body?.group_id || "");
      const targetId = String(body?.target_user_id || "");
      if (!uuid(groupId) || !uuid(targetId)) return out({ error: "شناسه بازیکن یا گروه معتبر نیست." }, 400, origin);
      const { data, error } = await db.rpc("baladi_transfer_group_leadership", { p_user_id: user.id, p_group_id: groupId, p_target_id: targetId });
      if (error) return out({ error: error.message || "انتقال رهبری انجام نشد." }, 409, origin);
      return out({ ok: true, result: data }, 200, origin);
    }

    if (action === "leave_group") {
      const groupId = String(body?.group_id || "");
      if (!uuid(groupId)) return out({ error: "شناسه گروه معتبر نیست." }, 400, origin);
      const { data, error } = await db.rpc("baladi_leave_group", { p_user_id: user.id, p_group_id: groupId });
      if (error) return out({ error: error.message || "خروج از گروه انجام نشد." }, 409, origin);
      return out({ ok: true, result: data }, 200, origin);
    }

    if (action === "group_chat_list") {
      const groupId = String(body?.group_id || "");
      if (!uuid(groupId)) return out({ error: "شناسه گروه معتبر نیست." }, 400, origin);
      const { data: membership, error: membershipError } = await db.from("baladi_group_members")
        .select("role").eq("group_id", groupId).eq("user_id", user.id).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) return out({ error: "فقط اعضای گروه به گفت‌وگوی آن دسترسی دارند." }, 403, origin);
      const { data: messages, error } = await db.from("baladi_group_messages")
        .select("id,group_id,user_id,body,sticker_id,is_pinned,created_at")
        .eq("group_id", groupId).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      const rows = (messages || []).reverse();
      const ids = [...new Set(rows.map((message: any) => message.user_id))];
      const { data: profiles, error: profilesError } = ids.length
        ? await db.from("baladi_game_profiles").select("user_id,display_name,avatar_path,equipped_frame_id,is_verified").in("user_id", ids)
        : { data: [], error: null };
      if (profilesError) throw profilesError;
      const profileMap = new Map((profiles || []).map((profile: any) => [profile.user_id, profile]));
      return out({ ok: true, messages: rows.map((message: any) => ({ ...message, player: profileMap.get(message.user_id) || { display_name: "بازیکن" } })) }, 200, origin);
    }

    if (action === "report_group_chat_message") {
      const groupId = String(body?.group_id || "");
      const messageId = Number(body?.message_id || 0);
      const reason = String(body?.reason || "");
      if (!uuid(groupId) || !Number.isSafeInteger(messageId) || messageId <= 0)
        return out({ error: "شناسه پیام یا گروه معتبر نیست." }, 400, origin);
      const { data, error } = await db.rpc("baladi_report_group_chat_message", {
        p_user_id: user.id, p_group_id: groupId, p_message_id: messageId, p_reason: reason
      });
      if (error) return out({ error: error.message || "گزارش پیام ثبت نشد." }, 409, origin);
      return out({ ok: true, result: data }, 201, origin);
    }

    if (action === "group_chat_send") {
      const groupId = String(body?.group_id || "");
      if (!uuid(groupId)) return out({ error: "شناسه گروه معتبر نیست." }, 400, origin);
      const bodyText = body?.sticker_id ? null : String(body?.body || "");
      const stickerId = body?.sticker_id ? String(body.sticker_id) : null;
      const { data, error } = await db.rpc("baladi_send_group_message", { p_user_id: user.id, p_group_id: groupId, p_body: bodyText, p_sticker_id: stickerId });
      if (error) return out({ error: error.message || "ارسال پیام گروه انجام نشد." }, 409, origin);
      return out({ ok: true, message: data }, 201, origin);
    }

    if (action === "pin_group_message") {
      const groupId = String(body?.group_id || "");
      const messageId = Number(body?.message_id || 0);
      const pinned = Boolean(body?.pinned);
      if (!uuid(groupId) || !Number.isInteger(messageId) || messageId <= 0) return out({ error: "شناسه پیام یا گروه معتبر نیست." }, 400, origin);
      const { data, error } = await db.rpc("baladi_pin_group_message", { p_user_id: user.id, p_group_id: groupId, p_message_id: messageId, p_pinned: pinned });
      if (error) return out({ error: error.message || "تغییر وضعیت پیام انجام نشد." }, 409, origin);
      return out({ ok: true, result: data }, 200, origin);
    }

    if (action === "active_duel") {
      const { data: match, error } = await db.from("baladi_duel_matches")
        .select("id,status,started_at")
        .eq("status", "active")
        .or(`player_one.eq.${user.id},player_two.eq.${user.id}`)
        .order("started_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      if (!match) return out({ ok: true, match_id: null, state: null }, 200, origin);
      const { data: state, error: stateError } = await db.rpc("baladi_duel_state", { p_user_id: user.id, p_match_id: match.id });
      if (stateError) throw stateError;
      return out({ ok: true, match_id: match.id, state }, 200, origin);
    }

    if (action === "duel_invites_list") {
      const { data: invites, error } = await db.from("baladi_duel_invites")
        .select("id,sender_id,created_at,expires_at,status")
        .eq("recipient_id", user.id).eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      const ids = [...new Set((invites || []).map((invite: any) => invite.sender_id))];
      const { data: profiles, error: profilesError } = ids.length
        ? await db.from("baladi_game_profiles").select("user_id,display_name,current_level,avatar_path,equipped_frame_id,is_verified").in("user_id", ids)
        : { data: [], error: null };
      if (profilesError) throw profilesError;
      const profileMap = new Map((profiles || []).map((profile: any) => [profile.user_id, profile]));
      return out({ ok: true, invites: (invites || []).map((invite: any) => ({ ...invite, sender: profileMap.get(invite.sender_id) || { display_name: "بازیکن" } })) }, 200, origin);
    }

    if (action === "send_duel_invite") {
      const targetId = String(body?.recipient_id || "");
      if (!uuid(targetId)) return out({ error: "شناسه بازیکن معتبر نیست." }, 400, origin);
      const { data, error } = await db.rpc("baladi_send_duel_invite", { p_sender_id: user.id, p_recipient_id: targetId });
      if (error) return out({ error: error.message || "ارسال دعوت انجام نشد." }, 409, origin);
      return out({ ok: true, invite: data }, 201, origin);
    }

    if (action === "accept_duel_invite") {
      const inviteId = String(body?.invite_id || "");
      if (!uuid(inviteId)) return out({ error: "شناسه درخواست معتبر نیست." }, 400, origin);
      const { data, error } = await db.rpc("baladi_accept_duel_invite", { p_user_id: user.id, p_invite_id: inviteId });
      if (error) return out({ error: error.message || "پذیرش مسابقه انجام نشد." }, 409, origin);
      return out({ ok: true, ...data }, 200, origin);
    }

    if (action === "decline_duel_invite") {
      const inviteId = String(body?.invite_id || "");
      if (!uuid(inviteId)) return out({ error: "شناسه درخواست معتبر نیست." }, 400, origin);
      const { data, error } = await db.rpc("baladi_decline_duel_invite", { p_user_id: user.id, p_invite_id: inviteId });
      if (error) return out({ error: error.message || "رد درخواست انجام نشد." }, 409, origin);
      return out({ ok: true, result: data }, 200, origin);
    }

    if (action === "duel_state") {
      const matchId = String(body?.match_id || "");
      if (!uuid(matchId)) return out({ error: "شناسه مسابقه معتبر نیست." }, 400, origin);
      const { data, error } = await db.rpc("baladi_duel_state", { p_user_id: user.id, p_match_id: matchId });
      if (error) return out({ error: error.message || "وضعیت مسابقه دریافت نشد." }, 409, origin);
      const { data: profile, error: profileError } = await db.from("baladi_game_profiles")
        .select("coins,wins,losses,current_level,display_name").eq("user_id", user.id).single();
      if (profileError) throw profileError;
      return out({ ok: true, state: data, profile }, 200, origin);
    }

    if (action === "duel_submit_word") {
      const matchId = String(body?.match_id || "");
      const word = String(body?.word || "");
      if (!uuid(matchId) || word.trim().length < 2 || word.length > 24)
        return out({ error: "اطلاعات واژه یا مسابقه معتبر نیست." }, 400, origin);
      const { data, error } = await db.rpc("baladi_duel_submit_word", { p_user_id: user.id, p_match_id: matchId, p_word: word });
      if (error) return out({ error: error.message || "بررسی واژه انجام نشد." }, 409, origin);
      const { data: profile, error: profileError } = await db.from("baladi_game_profiles")
        .select("coins,wins,losses,current_level,display_name").eq("user_id", user.id).single();
      if (profileError) throw profileError;
      return out({ ok: true, result: data, profile }, 200, origin);
    }

    if (action === "duel_spend_hint") {
      const matchId = String(body?.match_id || "");
      const hintType = String(body?.hint_type || "");
      if (!uuid(matchId)) return out({ error: "شناسه مسابقه معتبر نیست." }, 400, origin);
      const { data, error } = await db.rpc("baladi_duel_spend_hint", { p_user_id: user.id, p_match_id: matchId, p_hint_type: hintType });
      if (error) return out({ error: error.message || "استفاده از راهنمای مسابقه انجام نشد." }, 409, origin);
      const { data: profile, error: profileError } = await db.from("baladi_game_profiles")
        .select("coins,wins,losses,current_level,display_name").eq("user_id", user.id).single();
      if (profileError) throw profileError;
      return out({ ok: true, result: data, profile }, 200, origin);
    }

    if (action === "start_session") {
      const { error: ensureError } = await db.from("baladi_game_profiles")
        .upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });
      if (ensureError) throw ensureError;
      const { data: staleSessions, error: staleError } = await db.from("baladi_game_sessions")
        .select("id").eq("user_id", user.id).is("ended_at", null);
      if (staleError) throw staleError;
      for (const stale of (staleSessions || [])) {
        await db.rpc("baladi_touch_session", {
          p_session_id: stale.id, p_user_id: user.id, p_close: true
        });
      }
      const { data: profile, error: profileError } = await db.from("baladi_game_profiles")
        .select("current_level,coins,diamonds,name_change_count,sessions_count,display_name,daily_streak,last_checkin_date,avatar_path,avatar_unlocked,equipped_frame_id,wins,losses,is_verified").eq("user_id", user.id).single();
      if (profileError) throw profileError;
      const { data: session, error: insertError } = await db.from("baladi_game_sessions").insert({
        user_id: user.id,
        start_level: profile.current_level,
        end_level: profile.current_level,
        device_platform: "android"
      }).select("id,started_at").single();
      if (insertError) throw insertError;
      const { error: updateError } = await db.from("baladi_game_profiles").update({
        sessions_count: (Number(profile.sessions_count) || 0) + 1,
        last_played_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq("user_id", user.id);
      if (updateError) throw updateError;
      const { data: savedWords, error: wordsError } = await db.from("baladi_game_events")
        .select("metadata").eq("user_id", user.id).eq("event_type", "word_found")
        .eq("level_number", profile.current_level);
      if (wordsError) throw wordsError;
      const foundWords = (savedWords || []).map((item: any) => String(item.metadata?.word || "")).filter(Boolean);
      const { data: savedBonusWords, error: bonusWordsError } = await db.from("baladi_game_events")
        .select("metadata").eq("user_id", user.id).eq("event_type", "bonus_word_found")
        .eq("level_number", profile.current_level);
      if (bonusWordsError) throw bonusWordsError;
      const foundBonusWords = (savedBonusWords || []).map((item: any) => String(item.metadata?.word || "")).filter(Boolean);
      return out({ ok: true, session, profile, found_words: foundWords, found_bonus_words: foundBonusWords }, 201, origin);
    }

    if (action === "touch_session" || action === "end_session") {
      const sessionId = body?.session_id;
      if (!uuid(sessionId)) return out({ error: "شناسه نشست بازی معتبر نیست." }, 400, origin);
      const { data, error } = await db.rpc("baladi_touch_session", {
        p_session_id: sessionId,
        p_user_id: user.id,
        p_close: action === "end_session"
      });
      if (error) throw error;
      return out({ ok: true, profile: data }, 200, origin);
    }

    if (action === "complete_level") {
      const level = Number(body?.level);
      if (!Number.isInteger(level) || level < 1 || level > 10000) return out({ error: "شماره مرحله معتبر نیست." }, 400, origin);
      const sessionId = body?.session_id;
      if (!uuid(sessionId)) return out({ error: "نشست فعال بازی معتبر نیست." }, 400, origin);
      const { data, error } = await db.rpc("baladi_complete_level", { p_user_id: user.id, p_level: level, p_session_id: sessionId });
      if (error) return out({ error: error.message || "ثبت مرحله انجام نشد." }, 409, origin);
      if (uuid(body?.session_id)) {
        await db.from("baladi_game_sessions").update({ end_level: Math.min(10000, level + 1) })
          .eq("id", body.session_id).eq("user_id", user.id).is("ended_at", null);
      }
      return out({ ok: true, profile: data }, 200, origin);
    }

    if (action === "use_hint") {
      const sessionId = body?.session_id;
      const level = Number(body?.level);
      const word = String(body?.word || "").trim().normalize("NFC");
      if (!uuid(sessionId) || !Number.isInteger(level) || level < 1 || word.length < 2 || word.length > 24)
        return out({ error: "اطلاعات راهنما معتبر نیست." }, 400, origin);
      const { data, error } = await db.rpc("baladi_spend_hint", {
        p_user_id: user.id, p_session_id: sessionId, p_level: level, p_word: word
      });
      if (error) return out({ error: error.message || "مصرف سکه برای راهنما انجام نشد." }, 409, origin);
      return out({ ok: true, profile: data }, 200, origin);
    }

    if (action === "word_found") {
      const word = String(body?.word || "").trim().normalize("NFC").replace(/[ي]/g, "ی").replace(/[ك]/g, "ک").replace(/[‌ـ]/g, "");
      const sessionId = body?.session_id;
      const level = Number(body?.level);
      if (!uuid(sessionId) || !Number.isInteger(level) || level < 1 || word.length < 2 || word.length > 24)
        return out({ error: "اطلاعات کلمه معتبر نیست." }, 400, origin);
      const { data: activeSession, error: sessionError } = await db.from("baladi_game_sessions")
        .select("id").eq("id", sessionId).eq("user_id", user.id).is("ended_at", null).maybeSingle();
      if (sessionError) throw sessionError;
      if (!activeSession) return out({ error: "نشست بازی فعال نیست." }, 409, origin);
      const { data: current, error: currentError } = await db.from("baladi_game_profiles")
        .select("current_level,coins,words_found,bonus_words_found").eq("user_id", user.id).single();
      if (currentError) throw currentError;
      if (Number(current.current_level) !== level)
        return out({ error: "این مرحله در حساب شما فعال نیست." }, 409, origin);
      const { data: catalog, error: catalogError } = await db.from("baladi_game_level_catalog")
        .select("answers,letters").eq("level_number", level).eq("is_active", true).maybeSingle();
      if (catalogError) throw catalogError;
      if (!catalog) return out({ error: "اطلاعات مرحله در سرور موجود نیست." }, 404, origin);
      const availableLetters = new Map<string, number>();
      for (const letter of (catalog.letters || [])) {
        const normalizedLetter = String(letter).normalize("NFC").replace(/[ي]/g, "ی").replace(/[ك]/g, "ک");
        availableLetters.set(normalizedLetter, (availableLetters.get(normalizedLetter) || 0) + 1);
      }
      let canBeFormed = true;
      for (const character of Array.from(word)) {
        const remaining = availableLetters.get(character) || 0;
        if (remaining < 1) { canBeFormed = false; break; }
        availableLetters.set(character, remaining - 1);
      }
      if (!canBeFormed)
        return out({ error: "این واژه با حروف همین مرحله ساخته نمی‌شود." }, 400, origin);
      const isAnswer = (catalog.answers || []).includes(word);
      if (!isAnswer) {
        const { data: dictionaryEntry, error: dictionaryError } = await db.from("baladi_game_dictionary")
          .select("word").eq("word", word).maybeSingle();
        if (dictionaryError) throw dictionaryError;
        if (!dictionaryEntry)
          return out({ error: "این واژه در واژه‌نامه فارسی تأیید نشده است." }, 400, origin);
      }
      const eventType = isAnswer ? "word_found" : "bonus_word_found";
      const reward = isAnswer ? 3 : 7;
      const eventKey = level + ":" + word;
      const { error: eventError } = await db.from("baladi_game_events").insert({
        user_id: user.id, session_id: sessionId, event_type: eventType,
        event_key: eventKey, level_number: level, coin_delta: reward,
        metadata: { word, source: isAnswer ? "answer" : "dictionary_bonus" }
      });
      if (eventError && eventError.code !== "23505") throw eventError;
      if (!eventError) {
        const { data: updatedProfile, error: profileUpdateError } = await db.from("baladi_game_profiles").update({
          words_found: Number(current.words_found || 0) + 1,
          bonus_words_found: Number(current.bonus_words_found || 0) + (isAnswer ? 0 : 1),
          coins: Number(current.coins || 0) + reward,
          updated_at: new Date().toISOString()
        }).eq("user_id", user.id)
          .select("coins,current_level,completed_levels,levels_completed,total_play_seconds,sessions_count,words_found,bonus_words_found,hints_used,last_played_at")
          .single();
        if (profileUpdateError) throw profileUpdateError;
        return out({ ok: true, profile: updatedProfile, word_type: isAnswer ? "answer" : "bonus", coins_awarded: reward }, 200, origin);
      }
      const { data: unchangedProfile } = await db.from("baladi_game_profiles")
        .select("coins,current_level,completed_levels,levels_completed,total_play_seconds,sessions_count,words_found,bonus_words_found,hints_used,last_played_at")
        .eq("user_id", user.id).single();
      return out({ ok: true, profile: unchangedProfile, word_type: isAnswer ? "answer" : "bonus", coins_awarded: 0, already_found: true }, 200, origin);
    }

    return out({ error: "عملیات ناشناخته است." }, 400, origin);
  } catch (error) {
    console.error("baladi-game error", error);
    return out({ error: "ارتباط با حساب بازی انجام نشد. دوباره تلاش کن." }, 500, origin);
  }
});
