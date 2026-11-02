import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const ALLOWED=new Set(["https://alishams.ir","https://www.alishams.ir"]);
const headers=(origin:string)=>({"Access-Control-Allow-Origin":ALLOWED.has(origin)?origin:"https://alishams.ir","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
const out=(body:unknown,status:number,origin:string)=>new Response(JSON.stringify(body),{status,headers:headers(origin)});
const enc=new TextEncoder();
const toHex=(v:ArrayBuffer)=>Array.from(new Uint8Array(v)).map(x=>x.toString(16).padStart(2,"0")).join("");
function equal(a:string,b:string){if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0}
async function verifyInitData(raw:string,botToken:string){
 if(!raw||raw.length>8192)throw new Error("برای پرداخت، صفحه را از داخل مینی‌اپ بله باز کنید.");
 const p=new URLSearchParams(raw),hash=p.get("hash")||"",authDate=Number(p.get("auth_date")||0),userRaw=p.get("user")||"";
 if(!hash||!authDate||!userRaw)throw new Error("اطلاعات ورود مینی‌اپ بله کامل نیست.");
 const now=Math.floor(Date.now()/1000);
 if(authDate>now+60||now-authDate>900)throw new Error("نشست مینی‌اپ بله منقضی شده است؛ صفحه را دوباره باز کنید.");
 const check=[...p.entries()].filter(([k])=>k!=="hash").sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("\n");
 const key=await crypto.subtle.importKey("raw",enc.encode(botToken),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const secret=await crypto.subtle.sign("HMAC",key,enc.encode("WebAppData"));
 const key2=await crypto.subtle.importKey("raw",secret,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const calculated=toHex(await crypto.subtle.sign("HMAC",key2,enc.encode(check)));
 if(!equal(calculated,hash.toLowerCase()))throw new Error("اعتبار اطلاعات مینی‌اپ بله تأیید نشد.");
 let u:any;try{u=JSON.parse(userRaw)}catch{throw new Error("شناسه کاربر بله معتبر نیست.")}
 if(!u?.id)throw new Error("شناسه کاربر بله دریافت نشد.");
 return String(u.id);
}
async function bale(token:string,method:string,body:unknown){
 const r=await fetch("https://tapi.bale.ai/bot"+token+"/"+method,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 const j=await r.json().catch(()=>({}));
 if(!r.ok||j?.ok!==true){console.error("Bale API failure",method,r.status,j?.error_code||"unknown");throw new Error("ارتباط با سرویس پرداخت بله برقرار نشد.")}
 return j.result;
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin")||"";
 if(req.method==="OPTIONS")return new Response("ok",{headers:headers(origin)});
 if(req.method!=="POST")return out({error:"Method not allowed"},405,origin);
 if(!ALLOWED.has(origin))return out({error:"Origin not allowed"},403,origin);
 try{
  const jwt=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!jwt)return out({error:"برای ادامه وارد حساب کاربری شوید."},401,origin);
  const url=Deno.env.get("SUPABASE_URL")||"",anon=Deno.env.get("SUPABASE_ANON_KEY")||"",service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",botToken=Deno.env.get("BALE_BOT_TOKEN")||"";
  if(!url||!anon||!service||!botToken)return out({error:"تنظیمات امن سرویس پرداخت کامل نیست."},503,origin);
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:authData,error:authError}=await auth.auth.getUser(jwt),user=authData?.user;
  if(authError||!user?.id||!user.email)return out({error:"نشست کاربری معتبر نیست؛ دوباره وارد شوید."},401,origin);
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const email=user.email.trim().toLowerCase(),pattern=email.replace(/[\\\\%_]/g,"\\\\$&");
  const body=await req.json().catch(()=>({})),action=String(body?.action||"list"),mode=(Deno.env.get("BALE_PAYMENT_MODE")||"disabled").toLowerCase(),enabled=mode==="test"||mode==="live";
  if(action==="list"){
   const {data:projects,error:pe}=await db.from("client_projects").select("id").ilike("client_email",pattern);if(pe)throw pe;
   const ids=(projects||[]).map((x:any)=>x.id);if(!ids.length)return out({ok:true,enabled,mode,intents:[]},200,origin);
   const {data:intents,error}=await db.from("bale_payment_intents").select("id,project_id,amount_toman,status,payment_mode,created_at,updated_at,paid_at,expires_at").in("project_id",ids).eq("customer_user_id",user.id).order("created_at",{ascending:false}).limit(100);
   if(error)throw error;return out({ok:true,enabled,mode,intents:intents||[]},200,origin);
  }
  if(action==="create_invoice"){
   if(!enabled)return out({error:"پرداخت کیف پول بله هنوز در حالت غیرفعال است."},503,origin);
   const projectId=String(body?.project_id||"");if(!/^[0-9a-f-]{36}$/i.test(projectId))return out({error:"شناسه پروژه معتبر نیست."},400,origin);
   const {data:project,error:projectError}=await db.from("client_projects").select("id,title,client_email").eq("id",projectId).ilike("client_email",pattern).maybeSingle();
   if(projectError||!project||String(project.client_email||"").trim().toLowerCase()!==email)return out({error:"این پروژه به حساب شما تعلق ندارد."},404,origin);
   const baleUserId=await verifyInitData(String(body?.init_data||""),botToken);
   const payload="alishams_"+crypto.randomUUID();
   const {data:intent,error:intentError}=await db.rpc("create_bale_payment_intent",{p_project_id:projectId,p_customer_user_id:user.id,p_customer_email:email,p_bale_user_id:baleUserId,p_invoice_payload:payload,p_payment_mode:mode});
   if(intentError||!intent?.id){console.error("Bale intent create failed",intentError?.code||"unknown");return out({error:"ساخت درخواست پرداخت انجام نشد. مانده پروژه را بررسی و دوباره تلاش کنید."},409,origin)}
   if(intent.user_mismatch)return out({error:"برای این پروژه یک فاکتور فعال با حساب بله دیگری وجود دارد؛ پس از انقضای آن دوباره تلاش کنید."},409,origin);
   if(intent.invoice_url)return out({ok:true,reused:true,intent_id:intent.id,invoice_params:intent.invoice_url,amount_toman:intent.amount_toman,amount_rial:intent.amount_rial,expires_at:intent.expires_at,mode},200,origin);
   if(intent.existing)return out({error:"فاکتور قبلی در حال آماده‌سازی است؛ چند ثانیه دیگر دوباره تلاش کنید."},409,origin);
   try{
    const providerToken=mode==="test"?["WALLET","TEST","1111111111111111"].join("-"):(Deno.env.get("BALE_PAYMENT_TOKEN")||"");
    if(!providerToken)throw new Error("Live provider token is not configured");
    const invoice=await bale(botToken,"createInvoiceLink",{title:"پرداخت پروژه Alishams",description:("تسویه مانده پروژه "+String(project.title||"")).slice(0,255),payload,provider_token:providerToken,prices:[{label:"مانده پروژه",amount:Number(intent.amount_rial)}]});
    if(typeof invoice!=="string"||!invoice)throw new Error("Invalid invoice reference");
    const {error:saveError}=await db.from("bale_payment_intents").update({invoice_url:invoice,updated_at:new Date().toISOString()}).eq("id",intent.id).eq("status","pending");
    if(saveError)throw saveError;
    return out({ok:true,reused:false,intent_id:intent.id,invoice_params:invoice,amount_toman:intent.amount_toman,amount_rial:intent.amount_rial,expires_at:intent.expires_at,mode},201,origin);
   }catch(e){await db.from("bale_payment_intents").update({status:"failed",expires_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",intent.id).eq("status","pending");console.error("Bale invoice creation failed",e);return out({error:"ایجاد فاکتور در بله ناموفق بود. کمی بعد دوباره تلاش کنید."},502,origin)}
  }
  if(action==="status"){
   const id=String(body?.intent_id||"");if(!/^[0-9a-f-]{36}$/i.test(id))return out({error:"شناسه درخواست پرداخت معتبر نیست."},400,origin);
   const {data:intent,error}=await db.from("bale_payment_intents").select("id,project_id,amount_toman,status,payment_mode,created_at,updated_at,paid_at,expires_at").eq("id",id).eq("customer_user_id",user.id).eq("customer_email",email).maybeSingle();
   if(error||!intent)return out({error:"درخواست پرداخت پیدا نشد."},404,origin);return out({ok:true,intent},200,origin);
  }
  return out({error:"درخواست نامعتبر است."},400,origin);
 }catch(e){console.error("bale-payment",e);return out({error:e instanceof Error?e.message:"پردازش درخواست انجام نشد."},500,origin)}
});