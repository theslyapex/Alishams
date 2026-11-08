import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const ORIGINS=new Set(["https://alishams.ir","https://www.alishams.ir"]),OWNER="theslyapex@gmail.com",ADMIN_ID="20e3df23-9f5a-4d88-8adc-093f75feb5df";
const headers=(o:string)=>({"Access-Control-Allow-Origin":ORIGINS.has(o)?o:"https://alishams.ir","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
const out=(d:unknown,s:number,o:string)=>new Response(JSON.stringify(d),{status:s,headers:headers(o)});
const str=(v:unknown,n:number)=>String(v??"").trim().slice(0,n);
const tier=(n:number)=>n>=25000?"diamond":n>=18000?"gold":n>=10000?"silver":n>=2500?"bronze":"none";
const weekKey=()=>{const now=new Date(),d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));const day=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-day);return d.toISOString().slice(0,10)};
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin")||"";
 if(req.method==="OPTIONS")return new Response("ok",{headers:headers(origin)});
 if(req.method!=="POST")return out({error:"Method not allowed"},405,origin);
 if(!ORIGINS.has(origin))return out({error:"Origin not allowed"},403,origin);
 try{
  const url=Deno.env.get("SUPABASE_URL")||"",anon=Deno.env.get("SUPABASE_ANON_KEY")||"",service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!url||!anon||!service)return out({error:"سرویس باشگاه موقتاً در دسترس نیست."},503,origin);
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const body=await req.json().catch(()=>({})),action=str(body.action,40),jwt=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  let user:any=null,isAdmin=false;
  if(jwt){const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});const {data,error}=await auth.auth.getUser(jwt);if(!error&&data.user){user=data.user;isAdmin=user.id===ADMIN_ID&&user.email?.toLowerCase()===OWNER;if(isAdmin){const {data:claims,error:claimError}=await auth.auth.getClaims(jwt);if(claimError||(claims?.claims as any)?.aal!=="aal2")isAdmin=false}}}
  if(action==="leaderboard"){
   const {data:ranked,error}=await db.rpc("club_leaderboard");if(error)throw error;
   const list=(ranked||[]).map((x:any,i:number)=>({rank:i+1,display_name:x.display_name||"عضو باشگاه",lifetime_points:Number(x.lifetime_points||0),tier:x.tier,is_me:user?.id===x.user_id}));
   return out({ok:true,leaderboard:list,week_key:weekKey()},200,origin);
  }
  if(!user)return out({error:"برای ادامه وارد حساب کاربری شو."},401,origin);
  if(action==="status"){
   const [{data:ledger,error:le},{data:profile,error:pe},{data:teasers,error:te},{data:vouchers,error:ve}]=await Promise.all([
    db.from("club_point_ledger").select("id,points,event_type,description,created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(40),
    db.from("club_profiles").select("display_name").eq("user_id",user.id).maybeSingle(),
    db.from("club_teaser_requests").select("id,week_key,brief,status,admin_note,delivery_url,created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(12),
    db.from("club_reward_vouchers").select("id,code,points_spent,reward_toman,status,created_at,redeemed_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(20)
   ]);if(le||pe||te||ve)throw le||pe||te||ve;
   const {data:summary,error:se}=await db.rpc("club_account_summary",{p_user_id:user.id});if(se)throw se;
   const balance=Number(summary?.[0]?.balance||0),lifetime=Number(summary?.[0]?.lifetime||0);
   const current=tier(lifetime),threshold={none:0,bronze:2500,silver:10000,gold:18000,diamond:25000}[current],next={none:2500,bronze:10000,silver:18000,gold:25000,diamond:25000}[current];
   return out({ok:true,display_name:profile?.display_name||"",balance,lifetime,tier:current,next_threshold:next,progress:current==="diamond"?100:Math.max(0,Math.min(100,(lifetime-threshold)/(next-threshold)*100)),ledger:ledger||[],teaser_requests:teasers||[],vouchers:vouchers||[],diamond_eligible:current==="diamond",week_key:weekKey()},200,origin);
  }
  if(action==="profile_update"){
   const name=str(body.display_name,32);if(name.length<2||/[<>]/.test(name))return out({error:"نام نمایشی باید بین ۲ تا ۳۲ نویسه باشد."},400,origin);
   const {data,error}=await db.from("club_profiles").upsert({user_id:user.id,display_name:name,updated_at:new Date().toISOString()},{onConflict:"user_id"}).select("display_name").single();if(error)throw error;return out({ok:true,profile:data},200,origin);
  }
  if(action==="redeem"){
   const points=Number(body.points),reward=Number(body.reward_toman);
   const allowedRewards:Record<number,number>={2500:155000,10000:325000,18000:725000,25000:1450000};
   if(!Number.isInteger(points)||!Number.isInteger(reward)||allowedRewards[points]!==reward)
    return out({error:"مقدار امتیاز یا مبلغ پاداش معتبر نیست. صفحه را تازه‌سازی و دوباره تلاش کن."},400,origin);
   const {data:result,error}=await db.rpc("club_redeem_points",{p_user_id:user.id,p_points:points,p_reward_toman:reward});
   if(error){
    console.error("club redemption RPC failed",{code:error.code,message:error.message,details:error.details,hint:error.hint,user_id:user.id,points,reward});
    const reason=String(error.message||"").toLowerCase();
    if(reason.includes("insufficient_points"))return out({error:"امتیاز قابل استفاده‌ات برای این پاداش کافی نیست. موجودی امتیاز را بررسی کن."},400,origin);
    if(reason.includes("reward_already_claimed"))return out({error:"این پاداش را قبلاً یک‌بار دریافت کرده‌ای و امکان دریافت دوباره آن وجود ندارد."},409,origin);
    if(reason.includes("invalid_reward"))return out({error:"اطلاعات این پاداش با قوانین باشگاه مطابقت ندارد. صفحه را تازه‌سازی کن."},400,origin);
    return out({error:"صدور کد پاداش با خطای پایگاه داده روبه‌رو شد. لطفاً چند دقیقه بعد دوباره تلاش کن."},500,origin);
   }
   return out({ok:true,voucher:result},200,origin);
  }
  if(action==="teaser_submit"){
   const {data:summary,error:le}=await db.rpc("club_account_summary",{p_user_id:user.id});if(le)throw le;
   const lifetime=Number(summary?.[0]?.lifetime||0);if(tier(lifetime)!=="diamond")return out({error:"درخواست تیزر رایگان مخصوص اعضای سطح الماس است."},403,origin);
   const brief=str(body.brief,1200);if(brief.length<20)return out({error:"توضیحات تیزر باید حداقل ۲۰ نویسه باشد."},400,origin);
   const {data,error}=await db.from("club_teaser_requests").insert({user_id:user.id,week_key:weekKey(),brief}).select("id,status,week_key,created_at").single();if(error?.code==="23505")return out({error:"سهمیه تیزر رایگان این هفته را قبلاً ثبت کرده‌ای."},409,origin);if(error)throw error;return out({ok:true,request:data},201,origin);
  }
  if(!isAdmin)return out({error:"دسترسی مدیریت مجاز نیست."},403,origin);
  const audit=async(actionKey:string,entityType:string,entityId:string,summary:string,before:any=null,after:any=null)=>{const {error}=await db.from("admin_audit_logs").insert({actor_user_id:user.id,actor_email:user.email||OWNER,action_key:actionKey,entity_type:entityType,entity_id:entityId||null,summary,before_data:before,after_data:after});if(error)console.error("club audit insert failed",error.message)};
  if(action==="admin_users"){
   const page=Math.max(1,Math.min(100,Number(body.page)||1));
   const authRes=await fetch(url+"/auth/v1/admin/users?page="+page+"&per_page=1000",{headers:{"apikey":service,"Authorization":"Bearer "+service}});
   if(!authRes.ok)throw new Error("فهرست کاربران از سرویس احراز هویت دریافت نشد.");
   const authData=await authRes.json(),authUsers=Array.isArray(authData.users)?authData.users:[];
   const ids=authUsers.map((x:any)=>x.id).filter(Boolean);
   const profiles=ids.length?await db.from("club_profiles").select("user_id,display_name").in("user_id",ids):{data:[],error:null};
   if(profiles.error)throw profiles.error;
   const names=new Map((profiles.data||[]).map((x:any)=>[x.user_id,x.display_name]));
   const users=authUsers.map((x:any)=>({id:x.id,email:x.email||"",phone:x.phone||"",created_at:x.created_at||null,last_sign_in_at:x.last_sign_in_at||null,email_confirmed_at:x.email_confirmed_at||null,display_name:names.get(x.id)||x.user_metadata?.full_name||x.user_metadata?.name||x.user_metadata?.display_name||""}));
   return out({ok:true,users,page,has_more:authUsers.length===1000},200,origin);
  }
  if(action==="admin_list"){
   const [{data:ledger,error:le},{data:teasers,error:te}]=await Promise.all([db.from("club_point_ledger").select("*").order("created_at",{ascending:false}).limit(300),db.from("club_teaser_requests").select("*").order("created_at",{ascending:false}).limit(200)]);if(le||te)throw le||te;
   const ids=[...new Set([...(ledger||[]).map((x:any)=>x.user_id),...(teasers||[]).map((x:any)=>x.user_id)])];const profiles=ids.length?await db.from("club_profiles").select("user_id,display_name").in("user_id",ids):{data:[],error:null};if(profiles.error)throw profiles.error;const names=new Map((profiles.data||[]).map((x:any)=>[x.user_id,x.display_name]));
   return out({ok:true,ledger:ledger||[],teasers:(teasers||[]).map((x:any)=>({...x,display_name:names.get(x.user_id)||"عضو باشگاه"}))},200,origin);
  }
  if(action==="admin_adjust"){
   const uid=str(body.user_id,50),points=Number(body.points),description=str(body.description,250);if(!/^[0-9a-f-]{36}$/i.test(uid)||!Number.isInteger(points)||points===0||Math.abs(points)>100000||!description)return out({error:"اطلاعات تغییر امتیاز معتبر نیست."},400,origin);
   const {data:row,error}=await db.from("club_point_ledger").insert({user_id:uid,points,event_type:"admin_adjustment",source_id:crypto.randomUUID(),description}).select("id,points,event_type").single();if(error)throw error;await audit("club.points_adjusted","club_member",uid,"تغییر دستی امتیاز عضو باشگاه",{},{points:row.points,event_type:row.event_type,description});return out({ok:true},200,origin);
  }
  if(action==="admin_award_service"){
   const uid=str(body.user_id,50),order=str(body.order_id,50),amount=Number(body.amount_toman);if(!/^[0-9a-f-]{36}$/i.test(uid)||!/^[0-9a-f-]{36}$/i.test(order)||!Number.isSafeInteger(amount)||amount<0)return out({error:"اطلاعات سفارش معتبر نیست."},400,origin);
   const {data,error}=await db.rpc("club_award_service_purchase",{p_user_id:uid,p_order_id:order,p_amount_toman:amount});if(error)throw error;await audit("club.service_points_awarded","club_member",uid,"ثبت امتیاز خرید خدمت",{},{order_id:order,amount_toman:amount,points:Number(data)||0});return out({ok:true,points:data},200,origin);
  }
  if(action==="admin_teaser_update"){
   const id=str(body.id,50),status=str(body.status,20),note=str(body.admin_note,800),link=str(body.delivery_url,500);if(!/^[0-9a-f-]{36}$/i.test(id)||!["pending","in_progress","delivered","rejected"].includes(status))return out({error:"وضعیت درخواست معتبر نیست."},400,origin);
   const {data:before}=await db.from("club_teaser_requests").select("status").eq("id",id).maybeSingle();const {data,error}=await db.from("club_teaser_requests").update({status,admin_note:note,delivery_url:link,updated_at:new Date().toISOString()}).eq("id",id).select("id,status,user_id").single();if(error)throw error;await audit("club.teaser_updated","club_teaser_request",id,"به‌روزرسانی درخواست تیزر عضو",{status:before?.status},{status:data.status,user_id:data.user_id,delivery_url:link||null});return out({ok:true,request:data},200,origin);
  }
  return out({error:"عملیات ناشناخته است."},400,origin);
 }catch(e){console.error("club-api",e);return out({error:"عملیات باشگاه انجام نشد. دوباره تلاش کن."},500,origin)}
});
