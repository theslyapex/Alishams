import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const ORIGINS=new Set(["https://alishams.ir","https://www.alishams.ir"]);
const ADMIN_ID="20e3df23-9f5a-4d88-8adc-093f75feb5df";
const OWNER="theslyapex@gmail.com";
const cors=(o:string)=>({"Access-Control-Allow-Origin":ORIGINS.has(o)?o:"https://alishams.ir","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
const out=(b:unknown,s:number,o:string)=>new Response(JSON.stringify(b),{status:s,headers:cors(o)});
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin")||"";
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
 if(req.method!=="POST")return out({error:"Method not allowed"},405,origin);
 if(!ORIGINS.has(origin))return out({error:"Origin not allowed"},403,origin);
 try{
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!token||!url||!anon||!service)return out({error:"نشست مدیر معتبر نیست؛ دوباره وارد شو."},401,origin);
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await auth.auth.getUser(token);
  if(error||data.user?.id!==ADMIN_ID||data.user?.email?.toLowerCase()!==OWNER)return out({error:"دسترسی فقط برای مدیر مجاز است."},403,origin);
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const b=await req.json().catch(()=>({})),action=String(b.action||"list");
  if(action==="list"){
   const {data:rows,error}=await db.from("site_feedback").select("id,rating,category,message,display_name,email,page_url,status,admin_note,created_at,updated_at").order("created_at",{ascending:false}).limit(500);
   if(error)throw error;
   const total=rows?.length||0,avg=total?Math.round((rows.reduce((n:any,x:any)=>n+x.rating,0)/total)*10)/10:0;
   return out({ok:true,rows:rows||[],stats:{total,average:avg,new:(rows||[]).filter((x:any)=>x.status==="new").length,resolved:(rows||[]).filter((x:any)=>x.status==="resolved").length}},200,origin);
  }
  if(action==="update"){
   const id=String(b.id||""),status=String(b.status||""),note=String(b.admin_note||"").trim().slice(0,2000);
   if(!/^[0-9a-f-]{36}$/i.test(id)||!["new","reviewing","resolved","archived"].includes(status))return out({error:"اطلاعات و وضعیت انتخاب‌شده معتبر نیست."},400,origin);
   const {error}=await db.from("site_feedback").update({status,admin_note:note}).eq("id",id);
   if(error)throw error;
   return out({ok:true},200,origin);
  }
  if(action==="delete"){
   const id=String(b.id||"");
   if(!/^[0-9a-f-]{36}$/i.test(id))return out({error:"شناسه بازخورد معتبر نیست."},400,origin);
   const {error}=await db.from("site_feedback").delete().eq("id",id);
   if(error)throw error;
   return out({ok:true},200,origin);
  }
  return out({error:"عملیات ناشناخته است."},400,origin);
 }catch(e){console.error("site-feedback-admin",e);return out({error:"عملیات پنل بازخورد انجام نشد."},500,origin)}
});