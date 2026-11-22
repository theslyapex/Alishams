import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ORIGINS = new Set(["https://alishams.ir", "https://www.alishams.ir"]);
const OWNER_EMAIL = "theslyapex@gmail.com";
const ADMIN_ID = "20e3df23-9f5a-4d88-8adc-093f75feb5df";
const TZ = "Asia/Tehran";
const headers = (origin: string) => ({
  "Access-Control-Allow-Origin": ORIGINS.has(origin) ? origin : "https://alishams.ir",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
});
const reply = (body: unknown, status: number, origin: string) =>
  new Response(JSON.stringify(body), { status, headers: headers(origin) });
const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const tehranParts = (d: Date) => {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "short", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(d);
  return Object.fromEntries(p.filter(x => x.type !== "literal").map(x => [x.type, x.value]));
};
const jalaliDate = (d: Date) => {
  const p = new Intl.DateTimeFormat("en-US-u-ca-persian", {
    timeZone: TZ, year: "numeric", month: "numeric", day: "numeric"
  }).formatToParts(d);
  const v = Object.fromEntries(p.filter(x => x.type !== "literal").map(x => [x.type, x.value]));
  return `${v.year}/${v.month}/${v.day}`;
};
const code = () => "CONS-" + Array.from(crypto.getRandomValues(new Uint8Array(5)))
  .map(x => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x % 32]).join("");
const dbClient = () => {
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Booking service unavailable");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
};
async function adminSession(req: Request, origin: string) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!token || !url || !anon) throw new Response(JSON.stringify({error:"نشست مدیر معتبر نیست."}), {status:401,headers:headers(origin)});
  const auth = createClient(url, anon, {auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error} = await auth.auth.getUser(token);
  if (error || data.user?.id !== ADMIN_ID || data.user?.email?.toLowerCase() !== OWNER_EMAIL)
    throw new Response(JSON.stringify({error:"دسترسی فقط برای مدیر مجاز است."}), {status:403,headers:headers(origin)});
  const {data:claims,error:claimError} = await auth.auth.getClaims(token);
  if (claimError || claims?.claims?.aal !== "aal2")
    throw new Response(JSON.stringify({error:"برای مدیریت رزروها تأیید دومرحله‌ای لازم است."}), {status:403,headers:headers(origin)});
  return data.user;
}
const allowedStarts = (duration: number) => duration === 90 ? ["13:00","14:30","16:00"] : ["13:00","15:00"];
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return new Response("ok", {headers:headers(origin)});
  if (req.method !== "POST") return reply({error:"Method not allowed"},405,origin);
  if (!ORIGINS.has(origin)) return reply({error:"Origin not allowed"},403,origin);
  try {
    const body = await req.json().catch(() => ({}));
    const action = text(body.action, 30);
    const db = dbClient();

    if (action === "availability") {
      const from = text(body.from, 10), to = text(body.to, 10);
      if (!/^20\d{2}-\d{2}-\d{2}$/.test(from) || !/^20\d{2}-\d{2}-\d{2}$/.test(to))
        return reply({error:"بازه تاریخ معتبر نیست."},400,origin);
      const start = new Date(from + "T00:00:00+03:30"), end = new Date(to + "T00:00:00+03:30");
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime()-start.getTime()>40*86400000)
        return reply({error:"بازه تقویم معتبر نیست."},400,origin);
      const {data,error} = await db.from("consultation_bookings").select("start_at,end_at")
        .in("status",["pending","confirmed"]).gte("start_at",start.toISOString()).lt("start_at",end.toISOString());
      if (error) throw error;
      return reply({ok:true,busy:data||[]},200,origin);
    }

    if (action === "create") {
      if (text(body.website,120)) return reply({error:"درخواست نامعتبر است."},400,origin);
      const full_name=text(body.full_name,120), email=text(body.email,254).toLowerCase();
      const phone=text(body.phone,30), business_name=text(body.business_name,160);
      const project_type=text(body.project_type,20), project_brief=text(body.project_brief,3000);
      const duration=Number(body.duration_minutes), startAt=new Date(String(body.start_at||""));
      if (full_name.length<2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.replace(/\D/g,"").length<7 ||
          !["website","logo"].includes(project_type) || project_brief.length<10 ||
          ![90,120].includes(duration) || !Number.isFinite(startAt.getTime()))
        return reply({error:"اطلاعات فرم کامل یا معتبر نیست."},400,origin);
      const p=tehranParts(startAt), startClock=p.hour+":"+p.minute;
      const weekday=p.weekday;
      if (!["Fri","Sat","Sun","Mon"].includes(weekday) || !allowedStarts(duration).includes(startClock))
        return reply({error:"این تاریخ یا ساعت در برنامه جلسات مشاوره مجاز نیست."},400,origin);
      const endAt=new Date(startAt.getTime()+duration*60000), ep=tehranParts(endAt);
      if (ep.year!==p.year || ep.month!==p.month || ep.day!==p.day || ep.hour>18 || (ep.hour==="18" && ep.minute!=="00"))
        return reply({error:"زمان پایان جلسه باید حداکثر تا ساعت ۱۸ باشد."},400,origin);
      if (startAt.getTime() < Date.now()+15*60000 || startAt.getTime() > Date.now()+60*86400000)
        return reply({error:"تاریخ رزرو باید در ۶۰ روز آینده و حداقل ۱۵ دقیقه بعد باشد."},400,origin);
      const since=new Date(Date.now()-24*60*60*1000).toISOString();
      const {count:recentCount,error:rateError}=await db.from("consultation_bookings").select("id",{count:"exact",head:true}).eq("email",email).gte("created_at",since).in("status",["pending","confirmed"]);
      if(rateError)throw rateError;
      if((recentCount||0)>=3)return reply({error:"برای هر ایمیل حداکثر سه درخواست رزرو در ۲۴ ساعت قابل ثبت است."},429,origin);
      const localJalali=jalaliDate(startAt);
      const bookingCode=code();
      const {data,error}=await db.from("consultation_bookings").insert({
        booking_code:bookingCode,full_name,email,phone,business_name,project_type,project_brief,
        duration_minutes:duration,start_at:startAt.toISOString(),end_at:endAt.toISOString(),
        jalali_date:localJalali,status:"pending",source_page:"/services/online-business-consulting.html"
      }).select("id,booking_code,status,start_at,end_at,jalali_date,duration_minutes").single();
      if(error){
        if(error.code==="23P01" || error.code==="23505") return reply({error:"این زمان همین الان رزرو شده است. لطفاً یک ساعت دیگر انتخاب کن."},409,origin);
        throw error;
      }
      let telegramSent=false;
      const bot=Deno.env.get("TELEGRAM_BOT_TOKEN"), chat=Deno.env.get("TELEGRAM_CHAT_ID");
      if(bot&&chat){
        try{
          const msg="📅 رزرو جدید جلسه مشاوره | Alishams\n\nکد: "+bookingCode+
            "\nنام: "+full_name+"\nایمیل: "+email+"\nتلفن: "+phone+
            "\nکسب‌وکار: "+(business_name||"—")+"\nهدف: "+(project_type==="website"?"طراحی وب‌سایت":"طراحی لوگو")+
            "\nتاریخ شمسی: "+localJalali+"\nساعت: "+startClock+" تا "+ep.hour+":"+ep.minute+
            "\nمدت: "+duration+" دقیقه\nشرح: "+project_brief+
            "\n\nمدیریت: https://alishams.ir/admin-panel.html#consultations";
          const tr=await fetch("https://api.telegram.org/bot"+bot+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:chat,text:msg,disable_web_page_preview:true})});
          const td=await tr.json().catch(()=>({})); telegramSent=tr.ok&&td.ok===true;
        }catch(e){console.error("consultation telegram failed",e)}
      }
      return reply({ok:true,booking:{...data,telegram_sent:telegramSent}},201,origin);
    }

    const user=await adminSession(req,origin);
    if (action === "admin_list") {
      const status=text(body.status,20);
      let q=db.from("consultation_bookings").select("id,booking_code,full_name,email,phone,business_name,project_type,project_brief,duration_minutes,start_at,end_at,jalali_date,status,admin_note,created_at").order("start_at",{ascending:false}).limit(250);
      if (["pending","confirmed","cancelled","completed","no_show"].includes(status)) q=q.eq("status",status);
      const {data,error}=await q;if(error)throw error;
      return reply({ok:true,bookings:data||[]},200,origin);
    }
    if (action === "admin_update") {
      const id=text(body.id,50), status=text(body.status,20), note=text(body.admin_note,2000);
      if(!/^[0-9a-f-]{36}$/i.test(id)||!["confirmed","cancelled","completed","no_show"].includes(status))
        return reply({error:"اطلاعات تغییر وضعیت معتبر نیست."},400,origin);
      const {data:before,error:readError}=await db.from("consultation_bookings").select("id,booking_code,status,start_at").eq("id",id).maybeSingle();
      if(readError||!before)return reply({error:"رزرو پیدا نشد."},404,origin);
      const {data,error}=await db.from("consultation_bookings").update({status,admin_note:note,updated_at:new Date().toISOString()})
        .eq("id",id).select("id,booking_code,status,start_at,admin_note").single();
      if(error)throw error;
      const {error:auditError}=await db.from("admin_audit_logs").insert({
        actor_user_id:user.id,actor_email:user.email||OWNER_EMAIL,action_key:"consultation.booking."+status,
        entity_type:"consultation_booking",entity_id:id,summary:"تغییر وضعیت رزرو "+before.booking_code+" به "+status,
        before_data:before,after_data:data,metadata:{source:"consultation-booking-admin",auth_level:"aal2"}
      });
      if(auditError)console.error("consultation audit log failed",auditError);
      return reply({ok:true,booking:data},200,origin);
    }
    return reply({error:"عملیات شناخته نشد."},400,origin);
  } catch(e) {
    if(e instanceof Response) return e;
    console.error("consultation-booking error",e);
    return reply({error:"عملیات انجام نشد. کمی بعد دوباره تلاش کن."},500,origin);
  }
});