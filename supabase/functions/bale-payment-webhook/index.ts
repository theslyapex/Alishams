import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
async function notifyTelegram(text: string) {
 const bot=Deno.env.get("TELEGRAM_BOT_TOKEN")||"",chat=Deno.env.get("TELEGRAM_CHAT_ID")||"";
 if(!bot||!chat){console.error("Telegram notification secrets missing");return false;}
 try{
  const r=await fetch("https://api.telegram.org/bot"+bot+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:chat,text,disable_web_page_preview:true}),signal:AbortSignal.timeout(12000)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j?.ok!==true){console.error("Telegram payment notification failed",j?.description||r.status);return false;}
  return true;
 }catch(e){console.error("Telegram payment notification error",e);return false;}
}
async function bale(token:string,method:string,body:unknown){
 const r=await fetch("https://tapi.bale.ai/bot"+token+"/"+method,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 const j=await r.json().catch(()=>({}));
 if(!r.ok||j?.ok!==true){console.error("Bale API failure",method,r.status,j?.error_code||"unknown");throw new Error("Bale API request failed")}
 return j.result;
}
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const secret=Deno.env.get("BALE_WEBHOOK_SECRET")||"";
 const path=new URL(req.url).pathname.split("/").filter(Boolean);
 if(!secret||path[path.length-1]!==secret)return json({error:"Unauthorized"},401);
 try{
  const update=await req.json();
  const token=Deno.env.get("BALE_BOT_TOKEN")||"";
  const mode=(Deno.env.get("BALE_PAYMENT_MODE")||"disabled").toLowerCase();
  const url=Deno.env.get("SUPABASE_URL")||"";
  const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!token||!url||!service||!["test","live"].includes(mode))throw new Error("Payment webhook configuration is incomplete");
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const q=update?.pre_checkout_query;
  if(q){
   const payload=String(q.invoice_payload||""),userId=String(q.from?.id||"");
   const amount=Number(q.total_amount);
   let validation:any={ok:false};
   if(payload.startsWith("alishams_plus_")&&userId&&String(q.currency)==="IRR"&&Number.isSafeInteger(amount)){
    const {data:intent,error}=await db.from("plus_payment_intents").select("id,amount_rial,status,bale_user_id,payment_mode,expires_at").eq("invoice_payload",payload).maybeSingle();
    const valid=!error&&intent&&intent.status==="pending"&&intent.payment_mode===mode&&intent.bale_user_id===userId&&Number(intent.amount_rial)===amount&&new Date(intent.expires_at).getTime()>Date.now();
    if(valid){const {error:updateError}=await db.from("plus_payment_intents").update({status:"precheckout",bale_pre_checkout_query_id:String(q.id),updated_at:new Date().toISOString()}).eq("id",intent.id).eq("status","pending");validation={ok:!updateError};}
   }else if(payload&&userId&&String(q.currency)==="IRR"&&Number.isSafeInteger(amount)){
    const {data,error}=await db.rpc("validate_bale_precheckout",{p_invoice_payload:payload,p_total_amount:amount,p_currency:String(q.currency),p_bale_user_id:userId,p_payment_mode:mode,p_pre_checkout_query_id:String(q.id)});
    if(!error)validation=data||{ok:false};else console.error("Pre-checkout validation failed",error.code||"unknown");
   }
   await bale(token,"answerPreCheckoutQuery",{pre_checkout_query_id:q.id,ok:!!validation.ok,...(!validation.ok?{error_message:validation.reason==="balance_changed"?"مانده پروژه تغییر کرده است؛ فاکتور جدید دریافت کنید.":"اطلاعات پرداخت معتبر نیست یا فاکتور منقضی شده است."}:{})});
   return json({ok:true});
  }
  const payment=update?.message?.successful_payment;
  if(payment){
   const payload=String(payment.invoice_payload||""),chargeId=String(payment.telegram_payment_charge_id||payment.provider_payment_charge_id||""),providerId=String(payment.provider_payment_charge_id||payment.telegram_payment_charge_id||""),userId=String(update?.message?.from?.id||"");
   const required={invoice_payload:!!payload,telegram_payment_charge_id:!!chargeId,provider_payment_charge_id:!!providerId,user_id:!!userId,currency_irr:payment.currency==="IRR",total_amount_integer:Number.isSafeInteger(Number(payment.total_amount))};
   if(Object.values(required).some(v=>!v)){console.error("Bale successful_payment shape",JSON.stringify({payment_keys:Object.keys(payment||{}),message_keys:Object.keys(update?.message||{}),required}));return json({error:"Invalid payment data",missing:Object.entries(required).filter(([,v])=>!v).map(([k])=>k)},400)}
   if(payload.startsWith("alishams_plus_")){
    const {data:intent,error}=await db.from("plus_payment_intents").select("id,user_id,email,amount_toman,amount_rial,status,bale_user_id,payment_mode,bale_charge_id,provider_charge_id,expires_at").eq("invoice_payload",payload).maybeSingle();
    if(error||!intent)return json({error:"Unknown Plus invoice"},404);
    if(intent.payment_mode!==mode||intent.bale_user_id!==userId||Number(payment.total_amount)!==Number(intent.amount_rial)||new Date(intent.expires_at).getTime()<=Date.now())return json({error:"Plus payment validation failed"},409);
    if(intent.status==="paid"){const same=intent.bale_charge_id===chargeId&&intent.provider_charge_id===providerId;return same?json({ok:true,duplicate:true}):json({error:"Conflicting duplicate payment"},409)}
    const tx=await bale(token,"inquireTransaction",{transaction_id:chargeId});
    if(tx?.status!=="paid"||Number(tx?.amount)!==Number(intent.amount_rial)||(tx?.userID!=null&&String(tx.userID)!==userId)||(tx?.id!=null&&String(tx.id)!==chargeId))return json({error:"Plus transaction not verified"},409);
    const {data:finalized,error:finalizeError}=await db.rpc("finalize_plus_payment",{p_intent_id:intent.id,p_bale_charge_id:chargeId,p_provider_charge_id:providerId,p_raw_successful_payment:payment,p_bale_user_id:userId});
    if(finalizeError){console.error("Plus payment finalization failed",finalizeError.code||"unknown");return json({error:"Plus payment finalization requires review"},409)}
    if(!finalized?.duplicate)await notifyTelegram("💜 عضویت پلاس+ با موفقیت خریداری شد\\n\\nایمیل: "+intent.email+"\\nمبلغ: ۲٬۰۰۰٬۰۰۰ تومان\\nتخفیف فعال: "+String(finalized.discount_percent)+"٪\\nپایان عضویت: "+String(finalized.ends_at));
    return json({ok:true,plus:true,duplicate:!!finalized?.duplicate});
   }
   const {data:intent,error}=await db.from("bale_payment_intents").select("id,project_id,amount_toman,amount_rial,status,bale_user_id,payment_mode,bale_charge_id,provider_charge_id").eq("invoice_payload",payload).maybeSingle();
   if(error||!intent)return json({error:"Unknown invoice"},404);
   if(intent.payment_mode!==mode||intent.bale_user_id!==userId||Number(payment.total_amount)!==Number(intent.amount_rial))return json({error:"Payment validation failed"},409);
   if(intent.status==="paid"){const same=intent.bale_charge_id===chargeId&&intent.provider_charge_id===providerId;return same?json({ok:true,duplicate:true}):json({error:"Conflicting duplicate payment"},409)}
   const tx=await bale(token,"inquireTransaction",{transaction_id:chargeId});
   if(tx?.status!=="paid"||Number(tx?.amount)!==Number(intent.amount_rial)||(tx?.userID!=null&&String(tx.userID)!==userId)||(tx?.id!=null&&String(tx.id)!==chargeId))return json({error:"Transaction not verified"},409);
   const {data:finalized,error:finalizeError}=await db.rpc("finalize_bale_payment",{p_intent_id:intent.id,p_bale_charge_id:chargeId,p_provider_charge_id:providerId,p_raw_successful_payment:payment,p_bale_user_id:userId});
   if(finalizeError){console.error("Bale payment finalization failed",finalizeError.code||"unknown");return json({error:"Payment finalization requires review"},409)}
   if(!finalized?.duplicate){
    const {data:project}=await db.from("client_projects").select("title,client_name,client_email").eq("id",intent.project_id).maybeSingle();
    await notifyTelegram("✅ پرداخت موفق با کیف پول بله | Alishams Studio\\n\\n👤 مشتری: "+String(project?.client_name||"نامشخص")+"\\n📧 ایمیل: "+String(project?.client_email||"نامشخص")+"\\n📁 پروژه: "+String(project?.title||intent.project_id)+"\\n💰 مبلغ: "+Number(intent.amount_toman||0).toLocaleString("en-US")+" تومان\\n🧾 شناسه تراکنش: "+chargeId+"\\n🕒 وضعیت: پرداخت تأیید و ثبت شد.\\n\\n🔗 پنل مدیریت پروژه‌ها: https://alishams.ir/admin-projects.html");
   }
   return json({ok:true,duplicate:!!finalized?.duplicate});
  }
  return json({ok:true,ignored:true});
 }catch(e){console.error("bale-payment-webhook",e);return json({error:"Webhook processing failed"},500)}
});