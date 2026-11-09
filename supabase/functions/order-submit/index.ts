import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const origins=new Set(["https://alishams.ir","https://www.alishams.ir"]);
const h=(o:string)=>({"Access-Control-Allow-Origin":origins.has(o)?o:"https://alishams.ir","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin","Content-Type":"application/json; charset=utf-8"});
const res=(d:unknown,s:number,o:string)=>new Response(JSON.stringify(d),{status:s,headers:h(o)});
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,"0")).join("");
const rand=()=>Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,"0")).join("");
const code=()=> "ORD-"+Array.from(crypto.getRandomValues(new Uint8Array(6))).map(x=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x%32]).join("");
const str=(v:unknown,n:number)=>String(v??"").trim().slice(0,n);
const safe=(v:unknown,n:number)=>str(v,n).replace(/[<>&]/g,c=>({"<":"‹",">":"›","&":"＆"}[c]||c));
Deno.serve(async(req:Request)=>{const o=req.headers.get("origin")||"";if(req.method==="OPTIONS")return new Response("ok",{headers:h(o)});if(req.method!=="POST")return res({error:"Method not allowed"},405,o);if(!origins.has(o))return res({error:"Origin not allowed"},403,o);
try{
const b=await req.json(),client_name=str(b.client_name,120),client_email=str(b.client_email,254).toLowerCase(),contact_info=str(b.contact_info,254),services=Array.isArray(b.services)?[...new Set(b.services.map((x:unknown)=>str(x,180)).filter(Boolean))].slice(0,40):str(b.service,1500).split(/[|،,]/).map(x=>str(x,180)).filter(Boolean),service=services.join("، "),title=str(b.title,180),details=str(b.details,8000),budget=str(b.budget,100)||"فعلاً مشخص نیست",discount_code=str(b.discount_code,32).toUpperCase();
if(!client_name||!client_email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client_email)||contact_info.length<2||!service||!title||!details)return res({error:"لطفاً نام، ایمیل معتبر، شماره تماس، خدمت، عنوان و توضیحات سفارش را کامل کن."},400,o);
const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)return res({error:"سرویس ثبت سفارش فعلاً در دسترس نیست."},503,o);
const db=createClient(url,key,{auth:{persistSession:false}});
const {data:availability,error:availabilityError}=await db.from("site_service_settings").select("order_services").eq("setting_key","main").single();
if(availabilityError)throw availabilityError;
const unavailable=services.filter((name:string)=>availability?.order_services?.[name]===false);
if(unavailable.length)return res({error:"یکی از خدمات انتخاب‌شده در حال حاضر غیرفعال است: "+unavailable.join("، ")},400,o);
const hasDomainService=services.some((name:string)=>/دامنه|domain|ثبت دامنه|خرید دامنه/i.test(name));
const hasWebsiteDesign=services.some((name:string)=>/طراحی\s*وب.?سایت|طراحی\s*وب|website\s*design|web\s*design|پک اقتصادی طراحی سایت/i.test(name));
const domainOnly=hasDomainService&&!hasWebsiteDesign;
let plusDiscount=0,clubAccountId="",clubRewardAmount=0,clubVoucherId="",clubVoucherCode="";
const bearer=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
if(bearer){
 try{
  const anon=Deno.env.get("SUPABASE_ANON_KEY")||"";
  if(anon){const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});const {data:authData}=await auth.auth.getUser(bearer);const account=authData?.user;
   if(account?.id&&String(account.email||"").trim().toLowerCase()===client_email){clubAccountId=account.id;
    const hasCampaignOffer=services.some((name:string)=>name.includes("طراحی اختصاصی برند و وب")||name.includes("پکیج برنزی طراحی وبسایت")||name.includes("پکیج نقره‌ای طراحی وبسایت"));
    if(!hasCampaignOffer){
    const {data:membership}=await db.from("plus_memberships").select("status,starts_at,ends_at,discount_percent").eq("user_id",account.id).maybeSingle();
    if(membership&&membership.status==="active"&&membership.starts_at&&membership.ends_at&&new Date(membership.starts_at).getTime()<=Date.now()&&new Date(membership.ends_at).getTime()>Date.now())plusDiscount=Number(membership.discount_percent)===18?18:10;
    }
   }
  }
 }catch(e){console.error("Plus membership validation skipped",e)}
}
const access=rand();
if(!domainOnly&&discount_code.startsWith("CLUB-")){
 if(!clubAccountId)return res({error:"برای استفاده از اعتبار باشگاه باید با همان حساب کاربری وارد شده باشی."},401,o);
 const {data:voucher,error:voucherError}=await db.from("club_reward_vouchers").select("id,user_id,code,reward_toman,status").eq("code",discount_code).eq("user_id",clubAccountId).maybeSingle();
 if(voucherError)throw voucherError;
 if(!voucher||voucher.status!=="available")return res({error:"کد اعتبار باشگاه معتبر نیست یا قبلاً استفاده شده است."},400,o);
 clubVoucherId=voucher.id;clubVoucherCode=voucher.code;clubRewardAmount=Number(voucher.reward_toman)||0;
}else if(!domainOnly&&discount_code){
 const {data:referralReward,error:referralError}=await db.from("referral_rewards").select("user_id,status").eq("discount_code",discount_code).maybeSingle();
 if(referralError)throw referralError;
 if(referralReward){
  if(referralReward.status!=="available")return res({error:"این کد معرف قبلاً استفاده شده است."},400,o);
  const {data:ownerResult,error:ownerError}=await db.auth.admin.getUserById(referralReward.user_id);
  if(ownerError||String(ownerResult?.user?.email||"").trim().toLowerCase()!==client_email)
   return res({error:"این کد تخفیف به ایمیل حساب دیگری تعلق دارد."},403,o);
 }
}
let tracking=code();
for(let i=0;i<4;i++){const {data}=await db.from("client_orders").select("id").eq("tracking_code",tracking).maybeSingle();if(!data)break;tracking=code()}
const {data:order,error}=await db.from("client_orders").insert({tracking_code:tracking,user_id:clubAccountId||null,access_token_hash:await hash(access),client_name,client_email,contact_info,service,services,title,details,budget}).select("id,tracking_code,created_at").single();
if(error)throw error;
if(clubVoucherId){
 const {error:orderVoucherError}=await db.from("client_orders").update({club_reward_toman:clubRewardAmount,club_reward_code:clubVoucherCode}).eq("id",order.id);
 if(orderVoucherError){await db.from("client_orders").delete().eq("id",order.id);throw orderVoucherError}
 const {data:usedVoucher,error:useVoucherError}=await db.from("club_reward_vouchers").update({status:"redeemed",redeemed_order_id:order.id,redeemed_at:new Date().toISOString()}).eq("id",clubVoucherId).eq("status","available").select("id").maybeSingle();
 if(useVoucherError||!usedVoucher){await db.from("client_orders").delete().eq("id",order.id);return res({error:"این کد اعتبار هم‌زمان استفاده شده است؛ لطفاً دوباره تلاش کن."},409,o)}
}
let appliedDiscount=0,appliedCode=clubVoucherCode;
if(!domainOnly&&discount_code&&!clubVoucherId){
 const {data:redeemed,error:redeemError}=await db.rpc("redeem_discount_code",{p_code:discount_code,p_service:service});
 const row=Array.isArray(redeemed)?redeemed[0]:redeemed;
 if(redeemError||!row){await db.from("client_orders").delete().eq("id",order.id);return res({error:"کد تخفیف دیگر معتبر نیست یا ظرفیت استفاده از آن تکمیل شده است. لطفاً کد دیگری وارد کن."},400,o)}
 appliedDiscount=Number(row.discount_percent)||0;appliedCode=String(row.discount_code||discount_code);
 const {error:discountSaveError}=await db.from("client_orders").update({discount_code:appliedCode,discount_percent:appliedDiscount}).eq("id",order.id);
 if(discountSaveError){await db.rpc("release_discount_code",{p_code:appliedCode});await db.from("client_orders").delete().eq("id",order.id);throw discountSaveError}
}
if(!domainOnly&&plusDiscount>appliedDiscount){
 appliedDiscount=plusDiscount;appliedCode=plusDiscount===18?"PLUS18":"PLUS10";
 const {error:plusSaveError}=await db.from("client_orders").update({discount_code:appliedCode,discount_percent:appliedDiscount}).eq("id",order.id);
 if(plusSaveError)throw plusSaveError;
}
const {error:credentialError}=await db.rpc("store_customer_tracking_credential",{p_owner_email:client_email,p_item_type:"order",p_tracking_code:tracking,p_source_id:order.id,p_private_key:access});
if(credentialError)console.error("Order credential vault save failed",credentialError);
const {error:eventError}=await db.from("client_order_events").insert({order_id:order.id,status:"new",public_message:"درخواست شما ثبت شد و برای بررسی به مدیر ارسال شد."});
if(eventError)console.error("Order event insert failed",eventError);
let telegramSent=false;
const bot=Deno.env.get("TELEGRAM_BOT_TOKEN"),chat=Deno.env.get("TELEGRAM_CHAT_ID");
if(bot&&chat){
 try{
  const message="🆕 سفارش جدید | استودیو دیجیتال Alishams\n\n👤 نام: "+safe(client_name,120)+"\n📧 ایمیل: "+safe(client_email,254)+"\n📱 تماس: "+safe(contact_info,254)+"\n🛠 خدمات: "+safe(service,1500)+"\n📝 عنوان: "+safe(title,180)+"\n📄 توضیحات: "+safe(details,3500)+"\n💰 بودجه: "+safe(budget,100)+"\n🎟 کد تخفیف: "+(appliedCode?appliedCode+" ("+appliedDiscount+"%)":"ندارد")+"\n🎁 اعتبار باشگاه: "+(clubRewardAmount?clubRewardAmount.toLocaleString("fa-IR")+" تومان":"ندارد")+"\n🔎 کد پیگیری: "+tracking+"\n🔐 کلید خصوصی پیگیری: "+access+"\n🕒 زمان ثبت: "+new Date(order.created_at).toLocaleString("fa-IR",{timeZone:"Asia/Tehran"})+"\n\n🔗 پنل مدیریت: https://alishams.ir/orders-admin.html\n⚠️ کلید خصوصی را فقط برای پیگیری همین سفارش نگه دار.";
  const tr=await fetch("https://api.telegram.org/bot"+bot+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:chat,text:message,disable_web_page_preview:true})});
  const tj=await tr.json();telegramSent=tr.ok&&tj.ok===true;
  if(!telegramSent)console.error("Telegram order notification failed",tj?.description||tr.status);
 }catch(e){console.error("Telegram order notification failed",e)}
}else{console.error("Telegram secrets missing for order-submit")}
return res({ok:true,tracking_code:tracking,access_token:access,created_at:order.created_at,telegram_sent:telegramSent,discount_code:appliedCode,discount_percent:appliedDiscount},201,o)
}catch(e){console.error(e);return res({error:"ثبت سفارش انجام نشد. دوباره تلاش کن."},500,o)}});