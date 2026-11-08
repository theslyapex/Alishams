import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const origins = new Set(["https://alishams.ir", "https://www.alishams.ir"]);
const ADMIN_ID = "20e3df23-9f5a-4d88-8adc-093f75feb5df";
const logo = "https://alishams.ir/assets/alishams-studio-logo.svg";
function cors(origin:string){return {"Access-Control-Allow-Origin":origins.has(origin)?origin:"https://alishams.ir","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin","Content-Type":"application/json; charset=utf-8"}}
function out(body:unknown,status:number,origin:string){return new Response(JSON.stringify(body),{status,headers:cors(origin)})}
function esc(s:string){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!))}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin")||"";
 if(req.method==="OPTIONS")return new Response("ok",{status:200,headers:cors(origin)});
 if(req.method!=="POST")return out({error:"Method not allowed"},405,origin);
 if(!origins.has(origin))return out({error:"Origin not allowed"},403,origin);
 try{
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),resend=Deno.env.get("RESEND_API_KEY");
  if(!token||!url||!anon)return out({error:"نشست ورود معتبر نیست؛ دوباره وارد پنل شو."},401,origin);
  const auth=createClient(url,anon,{auth:{persistSession:false}});
  const {data:userData,error:userError}=await auth.auth.getUser(token);
  if(userError||userData.user?.id!==ADMIN_ID||userData.user?.email?.toLowerCase()!=="theslyapex@gmail.com")return out({error:"دسترسی فقط برای مدیر مجاز است. دوباره وارد شو."},403,origin);
  const body=await req.json(),tracking=String(body.tracking_code||"").trim(),message=String(body.message||"").trim();
  if(tracking.length<6||tracking.length>40||!message||message.length>5000)return out({error:"کد پیگیری و متن پاسخ را بررسی کن."},400,origin);
  const db=createClient(url,anon,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false}});
  const {data,error}=await db.rpc("admin_reply_communication_request",{p_tracking_code:tracking,p_message:message});
  if(error){console.error("Reply RPC failed",error.message);return out({error:"ذخیره پاسخ انجام نشد: "+error.message},500,origin)}
  const result=Array.isArray(data)?data[0]:data;
  if(!result?.ok)return out({error:"پاسخ ثبت نشد."},500,origin);
  let emailSent=false;
  if(resend&&result.sender_email){
   const subject=String(result.subject||"درخواست پشتیبانی"),sender=String(result.sender_name||"دوست عزیز");
   const safeMessage=esc(message).replace(/\n/g,"<br>");
   try{
    const mail=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+resend,"Content-Type":"application/json"},body:JSON.stringify({
     from:"Alishams Support <support@alishams.ir>",to:[result.sender_email],
     subject:"پاسخ جدید برای درخواست شما: "+subject,
     html:`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#080907;font-family:Arial,Tahoma,sans-serif;color:#f7f8f2;direction:rtl"><div style="display:none;max-height:0;overflow:hidden">پاسخ جدیدی برای درخواست شما در Alishams ثبت شده است.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#080907;padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#11120f;border:1px solid #343a25;border-radius:20px;overflow:hidden"><tr><td align="center" style="padding:26px 20px 18px;background:#050505"><img src="${logo}" width="190" alt="Alishams Studio" style="display:block;width:190px;max-width:80%;height:auto;border:0"><div style="font-size:11px;letter-spacing:3px;color:#d6ff59;margin-top:12px">DIGITAL STUDIO</div></td></tr><tr><td style="padding:28px 24px"><div style="font-size:12px;font-weight:bold;letter-spacing:1px;color:#d6ff59">COMMUNICATION CENTER</div><h1 style="font-size:23px;line-height:1.7;margin:9px 0 4px;color:#fff">پاسخ جدید برای شما</h1><p style="font-size:15px;line-height:2;color:#c6c9bd;margin:0 0 18px">سلام ${esc(sender)}، به درخواست شما پاسخ داده شده است.</p><div style="border:1px solid #3a4029;border-radius:14px;padding:16px;background:#090a07"><div style="font-size:12px;color:#d6ff59;margin-bottom:7px">موضوع مکاتبه</div><div style="font-size:15px;line-height:1.8;color:#fff">${esc(subject)}</div><div style="height:1px;background:#303426;margin:14px 0"></div><div style="font-size:12px;color:#d6ff59;margin-bottom:7px">پاسخ پشتیبانی</div><div style="font-size:15px;line-height:2;color:#f3f4ee;overflow-wrap:anywhere">${safeMessage}</div></div><div style="margin:20px 0 8px;padding:13px 15px;border-radius:12px;background:#1b2010;border:1px solid #3b4820"><span style="font-size:12px;color:#bfc6a9">کد پیگیری شما:</span><strong style="display:block;color:#d6ff59;letter-spacing:1px;font-size:17px;margin-top:5px">${esc(tracking)}</strong></div><table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px auto 12px"><tr><td align="center" bgcolor="#d6ff59" style="border-radius:10px"><a href="https://alishams.ir/contact-center.html" style="display:inline-block;padding:14px 24px;color:#111;text-decoration:none;font-weight:bold;font-size:15px">مشاهده و ادامه مکاتبه&nbsp; ←</a></td></tr></table><p style="font-size:12px;line-height:1.9;color:#9da18f;text-align:center;margin-top:20px">برای مشاهده تاریخچه و ارسال پاسخ، مرکز ارتباطات سایت را باز کنید. کلید خصوصی خود را محرمانه نگه دارید.</p></td></tr><tr><td align="center" style="padding:17px;border-top:1px solid #303426;color:#8e9283;font-size:11px;line-height:1.9">© Alishams Studio · پیام خودکار مرکز ارتباطات<br><a href="https://alishams.ir" style="color:#d6ff59;text-decoration:none">alishams.ir</a></td></tr></table></td></tr></table></body></html>`,
     text:"سلام "+sender+"،\n\nپاسخ جدیدی برای درخواست شما ثبت شده است.\nموضوع: "+subject+"\nکد پیگیری: "+tracking+"\n\nمتن پاسخ:\n"+message+"\n\nمشاهده مکاتبه: https://alishams.ir/contact-center.html\n\nAlishams Studio"
    })});
    emailSent=mail.ok;if(!mail.ok)console.error("Resend failed",mail.status,await mail.text());
   }catch(e){console.error("Resend error",e)}
  }
  return out({ok:true,email_sent:emailSent},201,origin);
 }catch(e){console.error("Admin reply error",e instanceof Error?e.message:e);return out({error:"درخواست نامعتبر است."},400,origin)}
});