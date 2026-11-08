import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const ORIGINS = new Set(["https://alishams.ir","https://www.alishams.ir"]);
const OWNER = "theslyapex@gmail.com";
const ADMIN_ID = "20e3df23-9f5a-4d88-8adc-093f75feb5df";
const headers = (origin:string) => ({
  "Access-Control-Allow-Origin": ORIGINS.has(origin) ? origin : "https://alishams.ir",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary":"Origin","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"
});
const reply=(data:unknown,status:number,origin:string)=>new Response(JSON.stringify(data),{status,headers:headers(origin)});
const cleanMap=(value:unknown,allowed:string[])=>{
  if(!value || typeof value!=="object" || Array.isArray(value)) throw new Error("ساختار تنظیمات معتبر نیست.");
  const result:Record<string,boolean>={};
  for(const key of allowed) result[key]=(value as Record<string,unknown>)[key]!==false;
  return result;
};
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin")||"";
 if(req.method==="OPTIONS") return new Response("ok",{headers:headers(origin)});
 if(req.method!=="POST") return reply({error:"Method not allowed"},405,origin);
 if(!ORIGINS.has(origin)) return reply({error:"Origin not allowed"},403,origin);
 try{
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service) return reply({error:"تنظیمات سرویس در دسترس نیست."},503,origin);
  const db=createClient(url,service,{auth:{persistSession:false}});
  const body=await req.json().catch(()=>({}));
  const action=String(body.action||"");
  const {data:settings,error}=await db.from("site_service_settings").select("order_services,homepage_services,updated_at").eq("setting_key","main").single();
  if(error) throw error;
  if(action==="public_list") return reply({ok:true,...settings},200,origin);
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token) return reply({error:"برای مدیریت وضعیت خدمات وارد حساب مدیر شو."},401,origin);
  const auth=createClient(url,anon,{auth:{persistSession:false}});
  const {data:userData,error:authError}=await auth.auth.getUser(token);
  if(authError||userData.user?.id!==ADMIN_ID||userData.user?.email?.toLowerCase()!==OWNER)
    return reply({error:"دسترسی فقط برای حساب مدیر مجاز است."},403,origin);
  if(action==="admin_list") return reply({ok:true,...settings},200,origin);
  if(action!=="save") return reply({error:"عملیات ناشناخته است."},400,origin);
  const allowedOrder=Object.keys(settings.order_services||{});
  const allowedHome=Object.keys(settings.homepage_services||{});
  const patch:Record<string,unknown>={updated_at:new Date().toISOString()};
  if(body.order_services!==undefined) patch.order_services=cleanMap(body.order_services,allowedOrder);
  if(body.homepage_services!==undefined) patch.homepage_services=cleanMap(body.homepage_services,allowedHome);
  if(Object.keys(patch).length===1) return reply({error:"تغییری برای ذخیره وجود ندارد."},400,origin);
  const {data:saved,error:saveError}=await db.from("site_service_settings").update(patch).eq("setting_key","main").select("order_services,homepage_services,updated_at").single();
  if(saveError) throw saveError;
  return reply({ok:true,...saved},200,origin);
 }catch(error){
  console.error("service-settings",error);
  return reply({error:"ذخیره تنظیمات خدمات انجام نشد."},500,origin);
 }
});