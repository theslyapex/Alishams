import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const ORIGINS=new Set(["https://alishams.ir","https://www.alishams.ir"]);
const OWNER="theslyapex@gmail.com",ADMIN_ID="20e3df23-9f5a-4d88-8adc-093f75feb5df";
const headers=(o:string)=>({"Access-Control-Allow-Origin":ORIGINS.has(o)?o:"https://alishams.ir","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
const out=(d:unknown,s:number,o:string)=>new Response(JSON.stringify(d),{status:s,headers:headers(o)});
const str=(v:unknown,n:number)=>String(v??"").trim().slice(0,n);
const active=(m:any)=>!!m&&m.status==="active"&&m.ends_at&&new Date(m.ends_at).getTime()>Date.now()&&(!m.starts_at||new Date(m.starts_at).getTime()<=Date.now());
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin")||"";
 if(req.method==="OPTIONS")return new Response("ok",{headers:headers(origin)});
 if(req.method!=="POST")return out({error:"Method not allowed"},405,origin);
 if(!ORIGINS.has(origin))return out({error:"Origin not allowed"},403,origin);
 try{
  const jwt=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  const url=Deno.env.get("SUPABASE_URL")||"",anon=Deno.env.get("SUPABASE_ANON_KEY")||"",service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!jwt||!url||!anon||!service)return out({error:"نشست معتبر نیست."},401,origin);
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:authData,error:authError}=await auth.auth.getUser(jwt),user=authData?.user;
  if(authError||!user?.id||!user.email)return out({error:"برای ادامه وارد حساب کاربری شو."},401,origin);
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const b=await req.json().catch(()=>({})),action=str(b.action,40),isAdmin=user.id===ADMIN_ID&&user.email.toLowerCase()===OWNER;
  if(action==="status"){
   const {data:membership,error}=await db.from("plus_memberships").select("*").eq("user_id",user.id).maybeSingle();if(error)throw error;
   const [{data:reels,error:re},{data:domains,error:de}]=await Promise.all([
    db.from("plus_reel_requests").select("id,reel_url,request_day,status,delivered_views,admin_note,created_at").eq("user_id",user.id).order("request_day",{ascending:false}).limit(40),
    db.from("plus_domain_requests").select("id,brand_name,desired_domain,related_order,status,admin_note,created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(20)
   ]);if(re||de)throw re||de;
   const {data:latestPayment,error:paymentError}=await db.from("plus_payment_intents").select("id,status,amount_toman,created_at,paid_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(1).maybeSingle();if(paymentError)throw paymentError;
   const {data:purchaseHistory,error:historyError}=await db.from("plus_purchase_records").select("id,payment_status,amount_toman,discount_percent,created_at,paid_at,admin_note,starts_at,ends_at,payment_provider").eq("user_id",user.id).order("created_at",{ascending:false}).limit(20);if(historyError)throw historyError;
   const latestManual=(purchaseHistory||[]).find((p:any)=>p.payment_provider==="card_transfer")||null;
   return out({ok:true,membership:membership?{...membership,is_active:active(membership)}:null,reels:reels||[],domains:domains||[],latest_payment:latestPayment||null,latest_manual_payment:latestManual,purchase_history:purchaseHistory||[]},200,origin);
  }
  if(action==="reel_submit"){
   const {data:m,error:me}=await db.from("plus_memberships").select("*").eq("user_id",user.id).maybeSingle();if(me)throw me;
   if(!active(m))return out({error:"برای ثبت درخواست بازدید رایگان، عضویت پلاس+ باید فعال باشد."},403,origin);
   const urlValue=str(b.reel_url,500);let parsed:URL;try{parsed=new URL(urlValue)}catch{return out({error:"لینک ریلز معتبر نیست."},400,origin)}
   const host=parsed.hostname.toLowerCase(),path=parsed.pathname;
   if(!["instagram.com","www.instagram.com","m.instagram.com"].includes(host)||!(path.startsWith("/reel/")||path.startsWith("/reels/")||path.startsWith("/p/")))return out({error:"فقط لینک مستقیم یک Reel اینستاگرام را وارد کن."},400,origin);
   const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tehran",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
   const {count:used,error:countError}=await db.from("plus_reel_requests").select("id",{count:"exact",head:true}).eq("user_id",user.id).gte("created_at",m.last_purchase_at||m.starts_at).lt("created_at",m.ends_at);if(countError)throw countError;
   if((used||0)>=30)return out({error:"سهمیه ۳۰ روزه بازدید هدیه این دوره عضویت تکمیل شده است."},409,origin);
   const {data:row,error}=await db.from("plus_reel_requests").insert({user_id:user.id,reel_url:parsed.toString(),request_day:day}).select("id,reel_url,request_day,status,created_at").single();
   if(error?.code==="23505")return out({error:"سهمیه امروزت قبلاً ثبت شده است. هر روز فقط یک درخواست ۵۰۰ ویویی امکان‌پذیر است."},409,origin);if(error)throw error;
   return out({ok:true,request:row},201,origin);
  }
  if(action==="domain_submit"){
   const {data:m,error:me}=await db.from("plus_memberships").select("*").eq("user_id",user.id).maybeSingle();if(me)throw me;
   if(!active(m))return out({error:"ثبت درخواست دامنه فقط برای اعضای فعال پلاس+ امکان‌پذیر است."},403,origin);
   const brand=str(b.brand_name,100),domain=str(b.desired_domain,100).toLowerCase(),order=str(b.related_order,180);
   if(!brand||!domain.endsWith(".ir")||!/^[a-z0-9-]+\\.ir$/.test(domain)||!order)return out({error:"نام برند، دامنه معتبر .ir و عنوان سفارش مشمول لازم است."},400,origin);
   const {data:orders,error:orderError}=await db.from("client_orders").select("id,title,service,services").ilike("client_email",user.email).order("created_at",{ascending:false}).limit(100);if(orderError)throw orderError;
   const eligible=(orders||[]).some((o:any)=>{const text=[o.title,o.service,...(Array.isArray(o.services)?o.services:[])].join(" ").toLowerCase();const matches=text.includes("وبسایت")||text.includes("وب سایت")||text.includes("پک اقتصادی طراحی سایت");return matches&&String(o.title||"").trim().toLowerCase()===order.toLowerCase()});
   if(!eligible)return out({error:"برای دریافت دامنه هدیه باید یک سفارش طراحی وب‌سایت یا پک اقتصادی طراحی سایت با همین حساب ثبت کرده باشی."},403,origin);
   const period=new Date(m.last_purchase_at||m.starts_at).toISOString();
   const {data:row,error}=await db.from("plus_domain_requests").insert({user_id:user.id,email:user.email,brand_name:brand,desired_domain:domain,related_order:order,membership_period_start:period}).select("id,brand_name,desired_domain,status,created_at").single();
   if(error?.code==="23505")return out({error:"سهمیه دامنه هدیه این دوره عضویت قبلاً استفاده شده است."},409,origin);if(error)throw error;
   return out({ok:true,request:row},201,origin);
  }
  if(action==="manual_submit"){
   const mime=str(b.mime_type,40).toLowerCase(),base64=String(b.image_base64||"");
   if(!new Set(["image/jpeg","image/png","image/webp"]).has(mime)||!base64||base64.length>7000000)return out({error:"فقط تصویر JPG، PNG یا WebP تا حجم ۵ مگابایت پذیرفته می‌شود."},400,origin);
   const {data:pending,error:pendingError}=await db.from("plus_purchase_records").select("id").eq("user_id",user.id).eq("payment_provider","card_transfer").eq("payment_status","pending").limit(1).maybeSingle();if(pendingError)throw pendingError;
   if(pending)return out({error:"یک رسید پلاس+ در انتظار بررسی مدیر داری. تا تعیین نتیجه، رسید جدید ارسال نکن."},409,origin);
   const raw=base64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/,"");let bytes:Uint8Array;
   try{const binary=atob(raw);bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i)}catch{return out({error:"خواندن تصویر رسید انجام نشد."},400,origin)}
   if(!bytes.length||bytes.length>5*1024*1024)return out({error:"حجم تصویر باید حداکثر ۵ مگابایت باشد."},400,origin);
   const ext=mime==="image/jpeg"?"jpg":mime==="image/png"?"png":"webp",path="plus/"+user.id+"/"+crypto.randomUUID()+"."+ext;
   const {error:uploadError}=await db.storage.from("project-deliverables").upload(path,bytes,{contentType:mime,upsert:false});if(uploadError)throw uploadError;
   const {data:row,error:insertError}=await db.from("plus_purchase_records").insert({user_id:user.id,email:user.email,amount_toman:2890000,discount_percent:10,payment_status:"pending",payment_provider:"card_transfer",payment_reference:"PLUS-CARD-"+crypto.randomUUID(),receipt_path:path,receipt_mime_type:mime}).select("id,payment_status,amount_toman,created_at").single();
   if(insertError){await db.storage.from("project-deliverables").remove([path]);throw insertError}
   return out({ok:true,payment:row},201,origin);
  }
  if(!isAdmin)return out({error:"دسترسی مدیریت مجاز نیست."},403,origin);
  if(action==="admin_search"){
   const q=str(b.query,180).toLowerCase();if(q.length<2)return out({ok:true,users:[]},200,origin);
   const users:any[]=[];for(let page=1;page<=20;page++){const {data,error}=await db.auth.admin.listUsers({page,perPage:100});if(error)throw error;for(const u of data.users||[]){const email=String(u.email||"").toLowerCase(),name=String(u.user_metadata?.full_name||"").toLowerCase();if(email.includes(q)||name.includes(q)||u.id===q)users.push({id:u.id,email:u.email,name:u.user_metadata?.full_name||"",created_at:u.created_at});}if(!data.users||data.users.length<100||users.length>=30)break;}return out({ok:true,users:users.slice(0,30)},200,origin);
  }
  if(action==="admin_list"){
   const [{data:members,error:me},{data:reels,error:re},{data:domains,error:de},{data:payments,error:pe},{data:manualRows,error:manualError}]=await Promise.all([
    db.from("plus_memberships").select("*").order("updated_at",{ascending:false}).limit(500),
    db.from("plus_reel_requests").select("*").order("created_at",{ascending:false}).limit(500),
    db.from("plus_domain_requests").select("*").order("created_at",{ascending:false}).limit(300),
    db.from("plus_payment_intents").select("id,user_id,email,amount_toman,status,paid_at,created_at,bale_charge_id").order("created_at",{ascending:false}).limit(500),
    db.from("plus_purchase_records").select("id,user_id,email,amount_toman,payment_status,payment_provider,created_at,paid_at,receipt_path,admin_note").eq("payment_provider","card_transfer").order("created_at",{ascending:false}).limit(500)
   ]);if(me||re||de||pe||manualError)throw me||re||de||pe||manualError;
   const users=await Promise.all((members||[]).map(async(m:any)=>{const {data}=await db.auth.admin.getUserById(m.user_id);return {...m,email:m.email||data?.user?.email||"",is_active:active(m)}}));
   const manualPayments=await Promise.all((manualRows||[]).map(async(p:any)=>{const {data}=await db.storage.from("project-deliverables").createSignedUrl(p.receipt_path,86400);return {...p,receipt_url:data?.signedUrl||null}}));
   return out({ok:true,members:users,reels:reels||[],domains:domains||[],payments:payments||[],manual_payments:manualPayments},200,origin);
  }
  if(action==="admin_set"){
   const uid=str(b.user_id,50);if(!/^[0-9a-f-]{36}$/i.test(uid))return out({error:"شناسه کاربر معتبر نیست."},400,origin);
   const {data:target,error:te}=await db.auth.admin.getUserById(uid);if(te||!target?.user?.email)return out({error:"کاربر پیدا نشد."},404,origin);
   const {data:old,error:oe}=await db.from("plus_memberships").select("*").eq("user_id",uid).maybeSingle();if(oe)throw oe;
   const enabled=b.enabled===true,now=new Date();
   let start:Date|null=null,end:Date|null=null;
   if(enabled){
    const currentStillActive=old?.status==="active"&&old?.ends_at&&new Date(old.ends_at)>now;
    start=b.starts_at?new Date(b.starts_at):(currentStillActive&&old?.starts_at?new Date(old.starts_at):now);
    end=b.ends_at?new Date(b.ends_at):(currentStillActive?new Date(new Date(old.ends_at).getTime()+30*86400000):new Date(start.getTime()+30*86400000));
    if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start)return out({error:"تاریخ شروع و پایان معتبر نیست."},400,origin);
   }
   const patch:any={email:target.user.email,status:enabled?"active":"inactive",starts_at:enabled?start!.toISOString():null,ends_at:enabled?end!.toISOString():null,discount_percent:Number(b.discount_percent)===18?18:10,admin_note:str(b.admin_note,1000),updated_at:now.toISOString()};
   if(enabled)patch.last_purchase_at=now.toISOString();
   let row:any=null;
   if(old){
    const {data,error}=await db.from("plus_memberships").update(patch).eq("user_id",uid).select("*").single();
    if(error)throw error;row=data;
   }else{
    const {data,error}=await db.from("plus_memberships").insert({user_id:uid,...patch,purchase_count:0}).select("*").single();
    if(error)throw error;row=data;
   }
   return out({ok:true,membership:{...row,is_active:active(row)}},200,origin);
  }
  if(action==="admin_manual_update"){
   const id=str(b.id,50),decision=str(b.decision,20),note=str(b.admin_note,1000);
   if(!/^[0-9a-f-]{36}$/i.test(id)||!["approve","reject"].includes(decision))return out({error:"درخواست یا تصمیم معتبر نیست."},400,origin);
   if(decision==="approve"){
    const {data,error}=await db.rpc("finalize_manual_plus_purchase",{p_purchase_id:id});if(error)return out({error:"خطای پایگاه داده هنگام فعال‌سازی: "+str(error.message,350)},500,origin);
    if(!data||data.ok!==true)return out({error:"پایگاه داده فعال‌سازی را تأیید نکرد؛ نتیجه نامعتبر دریافت شد."},500,origin);
    return out({ok:true,result:data},200,origin);
   }
   const {data:row,error}=await db.from("plus_purchase_records").update({payment_status:"failed",admin_note:note,reviewed_at:new Date().toISOString()}).eq("id",id).eq("payment_provider","card_transfer").eq("payment_status","pending").select("id,payment_status").single();
   if(error)throw error;
   return out({ok:true,payment:row},200,origin);
  }
  if(action==="admin_reel_update"){
   const id=str(b.id,50),status=str(b.status,20);if(!["pending","approved","delivered","rejected"].includes(status))return out({error:"وضعیت درخواست معتبر نیست."},400,origin);
   const {data:row,error}=await db.from("plus_reel_requests").update({status,delivered_views:Math.max(0,Math.min(500,Number(b.delivered_views)||0)),admin_note:str(b.admin_note,1000),updated_at:new Date().toISOString()}).eq("id",id).select("*").single();if(error)throw error;return out({ok:true,request:row},200,origin);
  }
  if(action==="admin_domain_update"){
   const id=str(b.id,50),status=str(b.status,20);if(!["pending","checking","registered","rejected"].includes(status))return out({error:"وضعیت دامنه معتبر نیست."},400,origin);
   const {data:row,error}=await db.from("plus_domain_requests").update({status,admin_note:str(b.admin_note,1000),updated_at:new Date().toISOString()}).eq("id",id).select("*").single();if(error)throw error;return out({ok:true,request:row},200,origin);
  }
  return out({error:"عملیات ناشناخته است."},400,origin);
 }catch(e){console.error("plus-membership",e);return out({error:"پردازش درخواست پلاس+ انجام نشد."},500,origin)}
});