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
const uuid = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (req.method !== "POST") return out({ error: "Method not allowed" }, 405, origin);
  if (origin && !ALLOWED.has(origin)) return out({ error: "Origin not allowed" }, 403, origin);

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token || !URL || !ANON || !SERVICE) return out({ error: "نشست کاربری معتبر نیست." }, 401, origin);

    const auth = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user?.id || !user.email) return out({ error: "برای استفاده از بازی وارد حساب کاربری سایت شو." }, 401, origin);

    const db = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "summary");

    if (action === "summary") {
      const { error: ensureError } = await db.from("baladi_game_profiles")
        .upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });
      if (ensureError) throw ensureError;
      const { data: profile, error } = await db.from("baladi_game_profiles")
        .select("coins,current_level,completed_levels,levels_completed,total_play_seconds,sessions_count,words_found,bonus_words_found,hints_used,last_played_at,created_at")
        .eq("user_id", user.id).single();
      if (error) throw error;
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
        .select("current_level,coins,sessions_count").eq("user_id", user.id).single();
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
        .select("answers").eq("level_number", level).eq("is_active", true).maybeSingle();
      if (catalogError) throw catalogError;
      if (!catalog) return out({ error: "اطلاعات مرحله در سرور موجود نیست." }, 404, origin);
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
