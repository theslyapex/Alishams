import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED = new Set(["https://alishams.ir","https://www.alishams.ir"]);
const OWNER = "theslyapex@gmail.com";
const ADMIN_ID = "20e3df23-9f5a-4d88-8adc-093f75feb5df";
const headers = (origin:string) => ({
  "Access-Control-Allow-Origin": ALLOWED.has(origin) ? origin : "https://alishams.ir",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Vary":"Origin",
  "Content-Type":"application/json; charset=utf-8"
});
const out=(body:unknown,status:number,origin:string)=>new Response(JSON.stringify(body),{status,headers:headers(origin)});
const sha256=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(b=>b.toString(16).padStart(2,"0")).join("");
const randomKey=()=>Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,"0")).join("");
const code=()=> "PRJ-"+Array.from(crypto.getRandomValues(new Uint8Array(5))).map(b=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b%32]).join("");
const str=(v:unknown,max:number)=>String(v??"").trim().slice(0,max);
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin")||"";
 if(req.method==="OPTIONS")return new Response("ok",{headers:headers(origin)});
 if(req.method!=="POST")return out({error:"Method not allowed"},405,origin);
 if(!ALLOWED.has(origin))return out({error:"Origin not allowed"},403,origin);
 try{
  const authHeader=req.headers.get("Authorization")||"";
  const token=authHeader.replace(/^Bearer\s+/i,"");
  const url=Deno.env.get("SUPABASE_URL"), anon=Deno.env.get("SUPABASE_ANON_KEY");
  if(!token||!url||!anon)return out({error:"نشست مدیر معتبر نیست."},401,origin);
  const auth=createClient(url,anon,{auth:{persistSession:false}});
  const {data:userData,error:userError}=await auth.auth.getUser(token);
  if(userError||userData.user?.id!==ADMIN_ID||userData.user?.email?.toLowerCase()!==OWNER)return out({error:"دسترسی فقط برای مدیر مجاز است."},403,origin);
  const {data:claimsData,error:claimsError}=await auth.auth.getClaims(token);
  if(claimsError||claimsData?.claims?.aal!=="aal2")return out({error:"برای عملیات مدیریتی، تأیید دومرحله‌ای لازم است."},403,origin);
  const db=createClient(url,anon,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false}});
  const b=await req.json(), action=str(b.action,40);

  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!serviceKey)return out({error:"تنظیمات ذخیره‌سازی ناقص است."},503,origin);
  const storageDb=createClient(url,serviceKey,{auth:{persistSession:false}});
  const pushCustomer=async(projectId:string,title:string,message:string)=>{
   try{const response=await fetch(url+"/functions/v1/push-dispatcher",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+serviceKey},body:JSON.stringify({project_id:projectId,title,message})});if(!response.ok)console.error("push dispatcher response",response.status,await response.text())}
   catch(error){console.error("push dispatcher call",error)}
  };

  if(action==="register_file"){
   const projectId=str(b.project_id,50),fileType=str(b.file_type,20)||"upload",filePath=str(b.file_path,500),fileName=str(b.file_name,255),description=str(b.description,2000),mime=str(b.mime_type,120)||"application/octet-stream",size=Number(b.file_size||0),isInvoice=b.is_invoice===true,content=String(b.content||"").slice(0,12000),externalUrl=str(b.external_url,2000);
   if(!projectId||!fileName||!["upload","text","link"].includes(fileType))return out({error:"اطلاعات مورد تحویل معتبر نیست."},400,origin);
   if(fileType==="upload"&&(!filePath.startsWith(projectId+"/")||!Number.isFinite(size)||size<1||size>209715200))return out({error:"اطلاعات فایل معتبر نیست."},400,origin);
   if(fileType==="text"&&!content.trim())return out({error:"متن تحویلی را وارد کن."},400,origin);
   if(fileType==="link"){try{const u=new URL(externalUrl);if(!["http:","https:"].includes(u.protocol))throw new Error();}catch{return out({error:"لینک معتبر با http یا https وارد کن."},400,origin)}}
   if(isInvoice&&(fileType!=="upload"||mime!=="application/pdf"||!fileName.toLowerCase().endsWith(".pdf")))return out({error:"فاکتور باید فایل PDF بارگذاری‌شده باشد."},400,origin);
   const {data:project,error:projectError}=await db.from("client_projects").select("id").eq("id",projectId).maybeSingle();if(projectError)throw projectError;if(!project)return out({error:"پروژه پیدا نشد."},404,origin);
   const storedPath=fileType==="upload"?filePath:"__"+fileType+"__/"+crypto.randomUUID();
   const {data:file,error}=await storageDb.from("project_files").insert({project_id:projectId,file_path:storedPath,file_name:fileName,description,mime_type:fileType==="text"?"text/plain":fileType==="link"?"text/uri-list":mime,file_size:fileType==="upload"?size:0,is_invoice:isInvoice,file_type:fileType,content:fileType==="text"?content:"",external_url:fileType==="link"?externalUrl:""}).select("*").single();if(error)throw error;
   return out({ok:true,file},201,origin);
  }
  if(action==="delete_file"){
   const fileId=str(b.file_id,50);if(!fileId)return out({error:"شناسه مورد لازم است."},400,origin);
   const {data:file,error}=await storageDb.from("project_files").select("id,file_path,file_type").eq("id",fileId).maybeSingle();if(error)throw error;if(!file)return out({error:"مورد پیدا نشد."},404,origin);
   if((file.file_type||"upload")==="upload"){const {error:removeError}=await storageDb.storage.from("project-deliverables").remove([file.file_path]);if(removeError)throw removeError;}
   const {error:deleteError}=await storageDb.from("project_files").delete().eq("id",fileId);if(deleteError)throw deleteError;
   return out({ok:true},200,origin);
  }

  if(action==="project_message_admin"){
   const projectId=str(b.project_id,50),message=str(b.message,5000);
   if(!projectId||message.length<1)return out({error:"شناسه پروژه و متن پیام لازم است."},400,origin);
   const {data:project,error:pe}=await storageDb.from("client_projects").select("id,title").eq("id",projectId).maybeSingle();if(pe)throw pe;if(!project)return out({error:"پروژه پیدا نشد."},404,origin);
   const {error}=await storageDb.from("project_messages").insert({project_id:projectId,sender_type:"admin",message_body:message});if(error)throw error;
   const {error:ne}=await storageDb.from("project_notifications").insert({project_id:projectId,recipient_type:"customer",notification_type:"admin_message",title:"پاسخ جدید از استودیو",body:project.title+" — "+message.slice(0,180)});if(ne)throw ne;
   await pushCustomer(projectId,"پاسخ جدید از استودیو | "+project.title,"برای پروژه «"+project.title+"» پیام تازه‌ای از طرف پشتیبانی دریافت کرده‌اید. برای مشاهده متن کامل و ادامه گفت‌وگو، وارد حساب کاربری شوید. "+message);
   return out({ok:true},201,origin);
  }
  if(action==="update_revision_request"){
   const id=str(b.request_id,50),status=str(b.status,20),response=str(b.admin_response,5000);
   if(!id||!["in_review","approved","rejected","completed"].includes(status))return out({error:"وضعیت درخواست معتبر نیست."},400,origin);
   const {data:req,error:re}=await storageDb.from("project_revision_requests").update({status,admin_response:response,updated_at:new Date().toISOString()}).eq("id",id).select("id,project_id").single();if(re)throw re;
   const {data:project,error:pe}=await storageDb.from("client_projects").select("title").eq("id",req.project_id).single();if(pe)throw pe;
   const revisionLabels:Record<string,string>={in_review:"در حال بررسی",approved:"تأیید شده",rejected:"رد شده",completed:"انجام شده"};
   const revisionLabel=revisionLabels[status]||status;
   const revisionBody="وضعیت درخواست اصلاح پروژه «"+project.title+"» به «"+revisionLabel+"» تغییر کرد."+(response?" توضیحات استودیو: "+response:"")+" برای مشاهده جزئیات و پیگیری نتیجه، وارد حساب کاربری شوید.";
   const {error:ne}=await storageDb.from("project_notifications").insert({project_id:req.project_id,recipient_type:"customer",notification_type:"revision_update",title:"تغییر وضعیت درخواست اصلاح",body:revisionBody.slice(0,900)});if(ne)throw ne;
   await pushCustomer(req.project_id,"درخواست اصلاح: "+revisionLabel,revisionBody);
   return out({ok:true},200,origin);
  }
  if(action==="moderate_project_review"){
   const id=str(b.review_id,50),approved=b.is_approved===true,featured=b.is_featured===true;
   if(!id)return out({error:"شناسه دیدگاه معتبر نیست."},400,origin);
   const {error}=await storageDb.from("project_reviews").update({is_approved:approved,is_featured:approved&&featured,updated_at:new Date().toISOString()}).eq("id",id);if(error)throw error;
   return out({ok:true},200,origin);
  }
  if(action==="get_file_url"){
   const fileId=str(b.file_id,50);if(!fileId)return out({error:"شناسه فایل معتبر نیست."},400,origin);
   const {data:file,error}=await storageDb.from("project_files").select("id,file_path,mime_type,is_invoice").eq("id",fileId).maybeSingle();if(error)throw error;if(!file)return out({error:"فایل پیدا نشد."},404,origin);
   if(file.is_invoice!==true || !String(file.mime_type||"").startsWith("image/"))return out({error:"این مورد تصویر رسید نیست."},400,origin);
   const {data:signed,error:signedError}=await storageDb.storage.from("project-deliverables").createSignedUrl(file.file_path,300);
   if(signedError||!signed?.signedUrl)throw signedError||new Error("ساخت لینک تصویر انجام نشد.");
   return out({ok:true,url:signed.signedUrl},200,origin);
  }
  if(action==="list"){
   const {data:projects,error}=await db.from("client_projects").select("*").order("updated_at",{ascending:false}).limit(200);
   if(error)throw error;
   const ids=(projects||[]).map(p=>p.id);
   let payments:any[]=[],history:any[]=[],files:any[]=[];
   if(ids.length){
    const [pr,hr]=await Promise.all([
     db.from("project_payments").select("*").in("project_id",ids).order("paid_at",{ascending:false}),
     db.from("project_status_history").select("*").in("project_id",ids).order("created_at",{ascending:false})
    ]);
    if(pr.error)throw pr.error;if(hr.error)throw hr.error;
    payments=pr.data||[];history=hr.data||[];
    const {data:fileRows,error:fileError}=await storageDb.from("project_files").select("*").in("project_id",ids).order("created_at",{ascending:false});if(fileError)throw fileError;files=fileRows||[];
   }
   const [messagesR,noticesR,revisionsR,reviewsR]=ids.length?await Promise.all([storageDb.from("project_messages").select("id,project_id,sender_type,message_body,created_at").in("project_id",ids).order("created_at",{ascending:true}).limit(1000),storageDb.from("project_notifications").select("id,project_id,recipient_type,notification_type,title,body,read_at,created_at").eq("recipient_type","admin").order("created_at",{ascending:false}).limit(300),storageDb.from("project_revision_requests").select("*").in("project_id",ids).order("created_at",{ascending:false}).limit(300),storageDb.from("project_reviews").select("*").in("project_id",ids).order("created_at",{ascending:false}).limit(300)]):[{data:[],error:null},{data:[],error:null},{data:[],error:null},{data:[],error:null}];if(messagesR.error||noticesR.error||revisionsR.error||reviewsR.error)throw messagesR.error||noticesR.error||revisionsR.error||reviewsR.error;
   return out({ok:true,projects:projects||[],payments,history,files,messages:messagesR.data||[],notifications:noticesR.data||[],revisions:revisionsR.data||[],reviews:reviewsR.data||[]},200,origin);
  }
  if(action==="create"){
   const client_name=str(b.client_name,120),client_email=str(b.client_email,254),title=str(b.title,180),description=str(b.description,8000);
   const total=Number(b.total_price||0),progress=Math.max(0,Math.min(100,Math.round(Number(b.progress)||0)));
   const status=str(b.status,30)||"not_started",target_date=str(b.target_date,10)||null,internal_notes=str(b.internal_notes,8000);
   if(!client_name||!title||!Number.isFinite(total)||total<0||!["not_started","in_progress","review","on_hold","completed","cancelled"].includes(status))return out({error:"اطلاعات پروژه معتبر نیست."},400,origin);
   const key=randomKey(); let tracking=code();
   for(let i=0;i<3;i++){
    const {data:exists}=await db.from("client_projects").select("id").eq("tracking_code",tracking).maybeSingle();
    if(!exists)break; tracking=code();
   }
   const {data:project,error}=await db.from("client_projects").insert({tracking_code:tracking,access_key_hash:await sha256(key),client_name,client_email,title,description,status,progress,total_price:total,target_date,internal_notes}).select("*").single();
   if(error)throw error;
   const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
   if(serviceKey && client_email){
    const vault=createClient(url,serviceKey,{auth:{persistSession:false}});
    const {error:vaultError}=await vault.rpc("store_customer_tracking_credential",{p_owner_email:client_email.toLowerCase(),p_item_type:"project",p_tracking_code:tracking,p_source_id:project.id,p_private_key:key});
    if(vaultError)console.error("Project credential vault save failed",vaultError);
   }
   const {error:histError}=await db.from("project_status_history").insert({project_id:project.id,status,progress,note:"ایجاد پروژه"});
   if(histError)throw histError;
   let telegramSent=false;
   const bot=Deno.env.get("TELEGRAM_BOT_TOKEN"),chat=Deno.env.get("TELEGRAM_CHAT_ID");
   if(bot&&chat){
    try{
     const msg="پروژه جدید در Alishams ثبت شد\nعنوان: "+title+"\nمشتری: "+client_name+"\nکد پیگیری: "+tracking+"\nکلید خصوصی: "+key+"\n\nاین اطلاعات محرمانه است؛ فقط برای مشتری مربوط ارسال شود.";
     const tr=await fetch("https://api.telegram.org/bot"+bot+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:chat,text:msg})});
     telegramSent=tr.ok;
    }catch(e){console.error("Telegram notification failed",e)}
   }
   return out({ok:true,project,tracking_code:tracking,access_key:key,telegram_sent:telegramSent},201,origin);
  }
  if(action==="rotate_key"){
   const id=str(b.id,50);
   if(!id)return out({error:"شناسه پروژه لازم است."},400,origin);
   const key=randomKey();
   const {data:project,error}=await db.from("client_projects").update({access_key_hash:await sha256(key),updated_at:new Date().toISOString()}).eq("id",id).select("id,tracking_code,title,client_name,client_email").single();
   if(error)throw error;
   const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
   if(serviceKey && project.client_email){
    const vault=createClient(url,serviceKey,{auth:{persistSession:false}});
    const {error:vaultError}=await vault.rpc("store_customer_tracking_credential",{p_owner_email:project.client_email.toLowerCase(),p_item_type:"project",p_tracking_code:project.tracking_code,p_source_id:project.id,p_private_key:key});
    if(vaultError)console.error("Project rotated credential vault save failed",vaultError);
   }
   let telegramSent=false;
   const bot=Deno.env.get("TELEGRAM_BOT_TOKEN"),chat=Deno.env.get("TELEGRAM_CHAT_ID");
   if(bot&&chat){
    try{
     const msg="کلید خصوصی پروژه در Alishams بازصدور شد\\nعنوان: "+project.title+"\\nمشتری: "+project.client_name+"\\nکد پیگیری: "+project.tracking_code+"\\nکلید خصوصی جدید: "+key+"\\n\\nکلید قبلی فوراً نامعتبر شده است. این اطلاعات محرمانه است.";
     const tr=await fetch("https://api.telegram.org/bot"+bot+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:chat,text:msg})});
     const tj=await tr.json();telegramSent=tr.ok&&tj.ok===true;
    }catch(e){console.error("Telegram key rotation notification failed",e)}
   }
   return out({ok:true,project,tracking_code:project.tracking_code,access_key:key,telegram_sent:telegramSent},200,origin);
  }
  if(action==="update"){
   const id=str(b.id,50);
   if(!id)return out({error:"شناسه پروژه لازم است."},400,origin);
   const patch:any={updated_at:new Date().toISOString()};
   if(b.client_name!==undefined)patch.client_name=str(b.client_name,120);
   if(b.client_email!==undefined)patch.client_email=str(b.client_email,254);
   if(b.title!==undefined)patch.title=str(b.title,180);
   if(b.description!==undefined)patch.description=str(b.description,8000);
   if(b.internal_notes!==undefined)patch.internal_notes=str(b.internal_notes,8000);
   if(b.total_price!==undefined){patch.total_price=Number(b.total_price);if(!Number.isFinite(patch.total_price)||patch.total_price<0)return out({error:"مبلغ کل معتبر نیست."},400,origin)}
   if(b.target_date!==undefined)patch.target_date=str(b.target_date,10)||null;
   if(b.status!==undefined){patch.status=str(b.status,30);if(!["not_started","in_progress","review","on_hold","completed","cancelled"].includes(patch.status))return out({error:"وضعیت معتبر نیست."},400,origin)}
   if(b.progress!==undefined){patch.progress=Math.max(0,Math.min(100,Math.round(Number(b.progress)||0)))}
   const {data:old,error:oldErr}=await db.from("client_projects").select("status,progress").eq("id",id).single();if(oldErr)throw oldErr;
   const {data:project,error}=await db.from("client_projects").update(patch).eq("id",id).select("*").single();if(error)throw error;
   if(old.status!==project.status||old.progress!==project.progress){
    const note=str(b.history_note,2000);
    const statusLabels:Record<string,string>={not_started:"هنوز شروع نشده",in_progress:"در حال انجام",review:"در انتظار بررسی و تأیید شما",on_hold:"متوقف موقت",completed:"تکمیل شده",cancelled:"لغو شده"};
    const changes:string[]=[];
    if(old.status!==project.status)changes.push("وضعیت پروژه از «"+(statusLabels[old.status]||old.status)+"» به «"+(statusLabels[project.status]||project.status)+"» تغییر کرد.");
    if(old.progress!==project.progress)changes.push("میزان پیشرفت پروژه از "+old.progress+"٪ به "+project.progress+"٪ رسید.");
    const detail=note?" توضیح استودیو: "+note:"";
    const message="در پروژه «"+project.title+"» تغییر جدیدی ثبت شده است. "+changes.join(" ")+detail+" برای مشاهده جزئیات، سوابق و آخرین وضعیت، وارد حساب کاربری خود شوید.";
    const {error:he}=await db.from("project_status_history").insert({project_id:id,status:project.status,progress:project.progress,note:note||changes.join(" ")});
    if(he)throw he;
    const {error:ne}=await storageDb.from("project_notifications").insert({project_id:id,recipient_type:"customer",notification_type:"project_update",title:"گزارش تازه از وضعیت پروژه",body:message.slice(0,900)});
    if(ne)throw ne;
    await pushCustomer(id,"وضعیت پروژه به‌روزرسانی شد",message);
   }
   return out({ok:true,project},200,origin);
  }
  if(action==="payment"){
   const project_id=str(b.project_id,50),amount=Number(b.amount),note=str(b.note,1000),method=str(b.method,30)||"other";
   if(!project_id||!Number.isFinite(amount)||amount<=0||!["cash","bank_transfer","online","other"].includes(method))return out({error:"مبلغ یا اطلاعات پرداخت معتبر نیست."},400,origin);
   const {data:payment,error}=await db.from("project_payments").insert({project_id,amount,note,method,confirmed:true}).select("*").single();if(error)throw error;
   return out({ok:true,payment},201,origin);
  }
  if(action==="delete"){
   const id=str(b.id,50);if(!id)return out({error:"شناسه پروژه لازم است."},400,origin);
   const {error}=await db.from("client_projects").delete().eq("id",id);if(error)throw error;
   return out({ok:true},200,origin);
  }
  return out({error:"عملیات ناشناخته است."},400,origin);
 }catch(e){console.error("project-tracker-admin error",e);return out({error:"عملیات انجام نشد. تنظیمات دسترسی و ساختار پایگاه داده را بررسی کن."},500,origin)}
});