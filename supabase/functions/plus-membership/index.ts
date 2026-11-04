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
   return out({ok:true,membership:membership?{...membership,is_active:active(membership)}:null,reels:reels||[],domains:domains||[],latest_payment:latestPayment||null},200,origin);
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
  if(!isAdmin)return out({error:"دسترسی مدیریت مجاز نیست."},403,origin);
  if(action==="admin_search"){
   const q=str(b.query,180).toLowerCase();if(q.length<2)return out({ok:true,users:[]},200,origin);
   const users:any[]=[];for(let page=1;page<=20;page++){const {data,error}=await db.auth.admin.listUsers({page,perPage:100});if(error)throw error;for(const u of data.users||[]){const email=String(u.email||"").toLowerCase(),name=String(u.user_metadata?.full_name||"").toLowerCase();if(email.includes(q)||name.includes(q)||u.id===q)users.push({id:u.id,email:u.email,name:u.user_metadata?.full_name||"",created_at:u.created_at});}if(!data.users||data.users.length<100||users.length>=30)break;}return out({ok:true,users:users.slice(0,30)},200,origin);
  }
  if(action==="admin_list"){
   const [{data:members,error:me},{data:reels,error:re},{data:domains,error:de},{data:payments,error:pe}]=await Promise.all([
    db.from("plus_memberships").select("*").order("updated_at",{ascending:false}).limit(500),
    db.from("plus_reel_requests").select("*").order("created_at",{ascending:false}).limit(500),
    db.from("plus_domain_requests").select("*").order("created_at",{ascending:false}).limit(300),
    db.from("plus_payment_intents").select("id,user_id,email,amount_toman,status,paid_at,created_at,bale_charge_id").order("created_at",{ascending:false}).limit(500)
   ]);if(me||re||de||pe)throw me||re||de||pe;
   const users=await Promise.all((members||[]).map(async(m:any)=>{const {data}=await db.auth.admin.getUserById(m.user_id);return {...m,email:m.email||data?.user?.email||"",is_active:active(m)}}));
   return out({ok:true,members:users,reels:reels||[],domains:domains||[],payments:payments||[]},200,origin);
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
   const patch:any={email:target.user.email,status:enabled?"active":"inactive",starts_at:enabled?start!.toISOString():null,ends_at:enabled?end!.toISOString():null,discount_percent:Number(b.discount_percent)===50?50:35,admin_note:str(b.admin_note,1000),updated_at:now.toISOString()};
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