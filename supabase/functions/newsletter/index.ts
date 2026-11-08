import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsFor = (origin:string|null) => ({
 "Access-Control-Allow-Origin": origin==="https://alishams.ir"||origin==="https://www.alishams.ir" ? origin : "https://alishams.ir",
 "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
 "Access-Control-Allow-Methods":"POST, OPTIONS",
 "Vary":"Origin",
 "Content-Type":"application/json"
});
const json=(body:unknown,status=200,origin:string|null=null)=>new Response(JSON.stringify(body),{status,headers:corsFor(origin)});
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("Origin");
 if(req.method==="OPTIONS") return new Response("ok",{headers:corsFor(origin)});
 if(req.method!=="POST") return json({error:"Method not allowed"},405,origin);
 try{
  const body=await req.json(); const action=String(body.action||"");
  const supabaseUrl=Deno.env.get("SUPABASE_URL")!; const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db=createClient(supabaseUrl,serviceKey);
  if(action==="subscribe"){
   const email=String(body.email||"").trim().toLowerCase();
   if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({error:"ایمیل معتبر وارد کن."},400,origin);
   const {data:old}=await db.from("newsletter_subscribers").select("status,confirm_token").eq("email",email).maybeSingle();
   if(old?.status==="active") return json({ok:true,message:"این ایمیل از قبل عضو خبرنامه است."},200,origin);
   const {data:row,error}=await db.from("newsletter_subscribers").upsert({email,status:"pending",confirm_token:crypto.randomUUID(),unsubscribed_at:null},{onConflict:"email"}).select("confirm_token").single();
   if(error||!row) throw error||new Error("Could not save subscription");
   const key=Deno.env.get("RESEND_API_KEY"); if(!key) throw new Error("Email provider is not configured");
   const confirmUrl="https://alishams.ir/newsletter.html?action=confirm&token="+encodeURIComponent(row.confirm_token);
   const resp=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({from:"Alishams Studio <info@alishams.ir>",to:[email],subject:"تأیید عضویت در خبرنامه Alishams Studio",html:`<div dir="rtl" style="font-family:Tahoma,Arial;background:#101116;color:#f5f5f5;padding:32px;border-radius:18px"><h2 style="color:#d9ff72">عضویت در خبرنامه</h2><p>برای تأیید عضویت در خبرنامه Alishams Studio روی دکمه زیر بزن.</p><a href="${confirmUrl}" style="display:inline-block;background:#d9ff72;color:#111;padding:12px 22px;border-radius:30px;text-decoration:none;font-weight:bold">تأیید عضویت</a><p style="color:#aaa;font-size:12px">اگر این درخواست را ثبت نکردی، این ایمیل را نادیده بگیر.</p></div>`,text:"برای تأیید عضویت در خبرنامه Alishams Studio این لینک را باز کن: "+confirmUrl})});
   if(!resp.ok) throw new Error("ارسال ایمیل تأیید انجام نشد.");
   return json({ok:true,message:"لینک تأیید به ایمیلت ارسال شد. صندوق ورودی و هرزنامه را بررسی کن."},200,origin);
  }
  if(action==="confirm"){
   const token=String(body.token||""); if(!token) return json({error:"لینک تأیید معتبر نیست."},400,origin);
   const {data,error}=await db.from("newsletter_subscribers").update({status:"active",confirmed_at:new Date().toISOString()}).eq("confirm_token",token).eq("status","pending").select("id").maybeSingle();
   if(error) throw error; if(!data) return json({error:"این لینک معتبر نیست یا قبلاً استفاده شده است."},400,origin);
   return json({ok:true,message:"عضویتت با موفقیت تأیید شد."},200,origin);
  }
  if(action==="unsubscribe"){
   const token=String(body.token||""); if(!token) return json({error:"لینک لغو عضویت معتبر نیست."},400,origin);
   const {data,error}=await db.from("newsletter_subscribers").update({status:"unsubscribed",unsubscribed_at:new Date().toISOString()}).eq("unsubscribe_token",token).select("id").maybeSingle();
   if(error) throw error; if(!data) return json({error:"لینک لغو عضویت معتبر نیست."},400);
   return json({ok:true,message:"عضویت خبرنامه لغو شد."},200,origin);
  }
  return json({error:"درخواست نامعتبر است."},400,origin);
 }catch(e){console.error("newsletter error",e);return json({error:e instanceof Error?e.message:"خطای سرور"},500)}
});