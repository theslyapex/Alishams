import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
(() => {
const SB_URL="https://srfldjfrzmtnlabusssq.supabase.co";
const SB_KEY="sb_publishable_UW2Wzzp8Y-KKd82nZHQUKA_RGl876RB";
const sb=createClient(SB_URL,SB_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const initials=s=>(String(s||"A").trim().slice(0,1)||"A");
const avatar=(url,name,size="")=>url?'<span class="ac-avatar '+size+'"><img src="'+esc(url)+'" alt="" loading="lazy"></span>':'<span class="ac-avatar '+size+'">'+esc(initials(name))+'</span>';
const fmt=d=>new Date(d).toLocaleString("fa-IR",{dateStyle:"medium",timeStyle:"short"});
const pageTitle=()=>document.querySelector('meta[property="og:title"]')?.content||document.querySelector('h1')?.textContent?.trim()||document.title.split("|")[0].trim();
const path=location.pathname.replace(/\/+$/,"")||"/";
const pageKey=()=>{const params=new URLSearchParams(location.search);const explicit=document.querySelector("[data-al-comments-key]")?.getAttribute("data-al-comments-key");return (explicit||path+(params.get("item")?":item:"+params.get("item"):"")+(params.get("video")?":video:"+params.get("video"):"")).slice(0,220)};
let currentUser=null,profile=null,sortMode="new",allComments=[];
async function getProfile(user){if(!user)return null;const {data}=await sb.from("user_profiles").select("*").eq("user_id",user.id).maybeSingle();return data||{user_id:user.id,display_name:user.user_metadata?.full_name||user.user_metadata?.name||user.email?.split("@")[0]||"کاربر",avatar_url:user.user_metadata?.avatar_url||null}}
async function syncProfile(user,avatarUrl){if(!user)return;const display_name=(user.user_metadata?.full_name||user.user_metadata?.name||user.email?.split("@")[0]||"کاربر").slice(0,80);const row={user_id:user.id,display_name,avatar_url:avatarUrl??user.user_metadata?.avatar_url??null,updated_at:new Date().toISOString()};await sb.from("user_profiles").upsert(row,{onConflict:"user_id"});}
function notice(el,msg,type=""){if(!el)return;el.textContent=msg;el.className="ac-notice"+(type?" "+type:"")}
function login(){location.href="/login.html?next="+encodeURIComponent(location.pathname+location.search+location.hash)}
function mountComments(){if(document.getElementById("al-comments"))return;const root=document.createElement("section");root.id="al-comments";root.innerHTML='<div class="ac-shell"><div class="ac-head"><div><div class="ac-kicker">ALISHAMS COMMUNITY</div><h2>گفت‌وگو و دیدگاه‌ها</h2><p class="ac-sub">تجربه‌ات را به اشتراک بگذار؛ گفت‌وگو را با احترام ادامه بده.</p></div><span class="ac-count">✦ <span id="ac-count">۰ دیدگاه</span></span></div><div class="ac-form"><div class="ac-formtop" id="ac-formtop"></div><form id="ac-form"><textarea id="ac-body" maxlength="2000" minlength="2" placeholder="نظر، تجربه یا پرسشت را اینجا بنویس…" required></textarea><div class="ac-formfoot"><span class="ac-hint">۲ تا ۲۰۰۰ نویسه · لطفاً محترمانه بنویس.</span><button class="ac-btn" type="submit">ثبت دیدگاه ↗</button></div><p class="ac-notice" id="ac-notice" aria-live="polite"></p></form></div><div class="ac-sort"><span>مرتب‌سازی:</span><button type="button" class="active" data-sort="new">تازه‌ترین</button><button type="button" data-sort="old">قدیمی‌ترین</button></div><div class="ac-list" id="ac-list"><div class="ac-empty">در حال بارگذاری دیدگاه‌ها…</div></div></div>';
const footer=document.querySelector("footer");if(footer)footer.parentNode.insertBefore(root,footer);else document.body.appendChild(root);drawFormTop();
const formtop=root.querySelector("#ac-formtop");
root.querySelector("#ac-form").addEventListener("submit",async e=>{e.preventDefault();if(!currentUser){notice(root.querySelector("#ac-notice"),"برای ثبت دیدگاه ابتدا وارد حساب کاربری‌ات شو.");return login()}const body=root.querySelector("#ac-body").value.trim();if(body.length<2)return notice(root.querySelector("#ac-notice"),"متن دیدگاه باید حداقل ۲ نویسه باشد.","error");const btn=root.querySelector('button[type="submit"]');btn.disabled=true;btn.textContent="در حال ثبت…";try{await syncProfile(currentUser,profile?.avatar_url);const {error}=await sb.from("site_comments").insert({user_id:currentUser.id,page_key:pageKey(),page_title:pageTitle().slice(0,180),body});if(error)throw error;root.querySelector("#ac-body").value="";notice(root.querySelector("#ac-notice"),"دیدگاهت با موفقیت ثبت شد.","success");await loadComments()}catch(err){notice(root.querySelector("#ac-notice"),err.message||"ثبت دیدگاه انجام نشد.","error")}finally{btn.disabled=false;btn.textContent="ثبت دیدگاه ↗"}});
root.querySelectorAll("[data-sort]").forEach(b=>b.addEventListener("click",()=>{sortMode=b.dataset.sort;root.querySelectorAll("[data-sort]").forEach(x=>x.classList.toggle("active",x===b));renderComments()}));
}
function drawFormTop(){const box=document.querySelector("#ac-formtop");if(!box)return;if(currentUser){box.innerHTML=avatar(profile?.avatar_url,profile?.display_name||currentUser.email)+'<div><strong>'+esc(profile?.display_name||currentUser.user_metadata?.full_name||"کاربر عزیز")+'</strong><small>دیدگاهت با حساب کاربری خودت ثبت می‌شود.</small></div>'}else{box.innerHTML='<span class="ac-avatar">✦</span><div><strong>به گفت‌وگو بپیوند</strong><small>برای نوشتن دیدگاه، وارد حساب کاربری شو.</small></div>'}}
async function loadComments(){const list=document.querySelector("#ac-list");if(!list)return;list.innerHTML='<div class="ac-empty">در حال دریافت دیدگاه‌ها…</div>';try{const {data,error}=await sb.from("site_comments").select("id,user_id,page_key,page_title,body,parent_id,created_at,updated_at").eq("page_key",pageKey()).eq("is_approved",true).order("created_at",{ascending:sortMode==="old"}).limit(300);if(error)throw error;allComments=data||[];const ids=[...new Set(allComments.map(x=>x.user_id))];let profiles={},likes={},myLikes=new Set();if(ids.length){const p=await sb.from("user_profiles").select("user_id,display_name,avatar_url").in("user_id",ids);(p.data||[]).forEach(x=>profiles[x.user_id]=x)}if(allComments.length){const l=await sb.from("site_comment_likes").select("comment_id,user_id").in("comment_id",allComments.map(x=>x.id));(l.data||[]).forEach(x=>{likes[x.comment_id]=(likes[x.comment_id]||0)+1;if(currentUser&&x.user_id===currentUser.id)myLikes.add(x.comment_id)})}document.querySelector("#ac-count").textContent=allComments.length.toLocaleString("fa-IR")+" دیدگاه";if(!allComments.length){list.innerHTML='<div class="ac-empty"><b>هنوز دیدگاهی ثبت نشده است</b>اولین نفری باش که تجربه یا پرسشت را با دیگران به اشتراک می‌گذارد.</div>';return}const byParent={};allComments.forEach(c=>{const key=c.parent_id||"root";(byParent[key]||(byParent[key]=[])).push(c)});const card=c=>{const p=profiles[c.user_id]||{display_name:"کاربر Alishams"};const mine=currentUser&&currentUser.id===c.user_id;return '<article class="ac-comment '+(c.parent_id?'ac-reply':'')+'" data-comment="'+c.id+'"><div class="ac-user">'+avatar(p.avatar_url,p.display_name)+'<div class="ac-userinfo"><strong>'+esc(p.display_name)+'</strong><time>'+esc(fmt(c.created_at))+(c.updated_at&&Math.abs(new Date(c.updated_at)-new Date(c.created_at))>60000?' · ویرایش‌شده':'')+'</time></div></div><div class="ac-commentbody" id="ac-body-'+c.id+'">'+esc(c.body)+'</div><div class="ac-actions"><button class="ac-action '+(myLikes.has(c.id)?"liked":"")+'" data-like="'+c.id+'">♥ '+(likes[c.id]||0)+' پسند</button><button class="ac-action" data-reply="'+c.id+'">↩ پاسخ</button>'+(mine?'<button class="ac-action" data-edit="'+c.id+'">ویرایش</button><button class="ac-action" data-delete="'+c.id+'">حذف</button>':"")+'</div><div id="ac-replybox-'+c.id+'"></div></article>'};
list.innerHTML=(byParent.root||[]).map(c=>card(c)+(byParent[c.id]||[]).map(card).join("")).join("")||'<div class="ac-empty">دیدگاهی برای نمایش وجود ندارد.</div>';
list.querySelectorAll("[data-like]").forEach(b=>b.addEventListener("click",async()=>{if(!currentUser)return login();const id=b.dataset.like;const has=myLikes.has(id);const res=has?await sb.from("site_comment_likes").delete().eq("comment_id",id).eq("user_id",currentUser.id):await sb.from("site_comment_likes").insert({comment_id:id,user_id:currentUser.id});if(res.error){alert("ثبت پسند انجام نشد: "+res.error.message);return}await loadComments()}));
list.querySelectorAll("[data-reply]").forEach(b=>b.addEventListener("click",()=>{if(!currentUser)return login();const id=b.dataset.reply,box=document.getElementById("ac-replybox-"+id);if(box.innerHTML)return box.innerHTML="";box.innerHTML='<form class="ac-replyform"><textarea maxlength="2000" minlength="2" placeholder="پاسخت را بنویس…" required></textarea><div class="ac-formfoot"><button class="ac-btn" type="submit">ارسال پاسخ</button><button class="ac-btn ghost" type="button" data-cancel>انصراف</button></div><p class="ac-notice"></p></form>';box.querySelector("[data-cancel]").onclick=()=>box.innerHTML="";box.querySelector("form").onsubmit=async e=>{e.preventDefault();const body=box.querySelector("textarea").value.trim(),n=box.querySelector(".ac-notice");if(body.length<2)return notice(n,"متن پاسخ کوتاه است.","error");const r=await sb.from("site_comments").insert({user_id:currentUser.id,page_key:pageKey(),page_title:pageTitle().slice(0,180),body,parent_id:id});if(r.error)return notice(n,r.error.message,"error");await syncProfile(currentUser,profile?.avatar_url);await loadComments()}}));
list.querySelectorAll("[data-delete]").forEach(b=>b.addEventListener("click",async()=>{if(!confirm("این دیدگاه و پاسخ‌های زیر آن حذف شوند؟"))return;const r=await sb.from("site_comments").delete().eq("id",b.dataset.delete).eq("user_id",currentUser.id);if(r.error)alert(r.error.message);else await loadComments()}));
list.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>{const id=b.dataset.edit,el=document.getElementById("ac-body-"+id),old=allComments.find(x=>x.id===id)?.body;if(!old)return;el.innerHTML='<textarea maxlength="2000" minlength="2">'+esc(old)+'</textarea><div class="ac-formfoot"><button class="ac-btn" type="button" data-save>ذخیره</button><button class="ac-btn ghost" type="button" data-cancel>انصراف</button></div><p class="ac-notice"></p>';el.querySelector("[data-cancel]").onclick=()=>loadComments();el.querySelector("[data-save]").onclick=async()=>{const body=el.querySelector("textarea").value.trim();if(body.length<2)return notice(el.querySelector(".ac-notice"),"متن دیدگاه کوتاه است.","error");const r=await sb.from("site_comments").update({body,updated_at:new Date().toISOString()}).eq("id",id).eq("user_id",currentUser.id);if(r.error)return notice(el.querySelector(".ac-notice"),r.error.message,"error");await loadComments()}}))
}catch(err){list.innerHTML='<div class="ac-empty">بارگذاری دیدگاه‌ها با خطا روبه‌رو شد.<br>'+esc(err.message||"لطفاً کمی بعد دوباره تلاش کن.")+'</div>'}}
function renderComments(){loadComments()}
async function setupAvatarSettings(user){
const panel=document.querySelector("#profilePanel");
if(!panel||panel.querySelector("#ac-avatar-form"))return;
const first=panel.querySelector("section.card");
if(!first)return;
const card=document.createElement("section");
card.className="card ac-profile-avatar-card";
card.innerHTML='<div class="section-head"><h2>تصویر پروفایل</h2><small>نمایش کنار دیدگاه‌ها</small></div><form id="ac-avatar-form"><div class="ac-avatar-settings"><div class="ac-avatar-preview-frame"><div id="ac-avatar-preview" class="ac-avatar">✦</div></div><div class="ac-avatar-controls"><input id="ac-avatar-file" type="file" accept="image/jpeg,image/png,image/webp"><div class="ac-avatar-tip">تصویر JPG، PNG یا WebP · حداکثر ۵ مگابایت<br>پس از انتخاب، می‌توانی تصویر را دقیقاً به‌شکل مربع ۱:۱ برش بدهی.</div><div class="ac-avatar-actions"><button class="btn primary" type="submit">ذخیره تصویر</button><button class="btn" id="ac-avatar-remove" type="button">حذف تصویر</button></div></div></div><p id="ac-avatar-notice" class="notice" aria-live="polite"></p></form>';
panel.insertBefore(card,first.nextSibling);
const file=card.querySelector("#ac-avatar-file"),preview=card.querySelector("#ac-avatar-preview"),noticeEl=card.querySelector("#ac-avatar-notice");
let existing=profile?.avatar_url||user.user_metadata?.avatar_url||null;
let croppedBlob=null,cropper=null,sourceUrl=null;
const show=url=>{preview.innerHTML=url?'<img src="'+esc(url)+'" alt="تصویر پروفایل">':esc(initials(profile?.display_name||user.user_metadata?.full_name||user.email));};
show(existing);
const loadCropper=async()=>{
 if(window.Cropper)return;
 if(!document.querySelector('link[data-ac-cropper-css]')){const l=document.createElement("link");l.rel="stylesheet";l.href="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.css";l.dataset.acCropperCss="1";document.head.appendChild(l)}
 await new Promise((resolve,reject)=>{const existingScript=document.querySelector('script[data-ac-cropper-js]');if(existingScript){if(window.Cropper)return resolve();existingScript.addEventListener("load",resolve,{once:true});existingScript.addEventListener("error",reject,{once:true});return}const s=document.createElement("script");s.src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.js";s.dataset.acCropperJs="1";s.onload=resolve;s.onerror=()=>reject(new Error("ابزار برش تصویر بارگذاری نشد. اتصال اینترنت را بررسی کن."));document.head.appendChild(s)});
 if(!window.Cropper)throw new Error("ابزار برش تصویر در دسترس نیست.");
};
const openCropper=async f=>{
 if(!["image/jpeg","image/png","image/webp"].includes(f.type)||f.size>5*1024*1024){file.value="";throw new Error("فقط تصویر JPG، PNG یا WebP تا حجم ۵ مگابایت مجاز است.")}
 await loadCropper();
 if(sourceUrl)URL.revokeObjectURL(sourceUrl);
 sourceUrl=URL.createObjectURL(f);
 const modal=document.createElement("div");
 modal.className="ac-crop-modal";
 modal.innerHTML='<div class="ac-crop-dialog" role="dialog" aria-modal="true" aria-labelledby="ac-crop-title"><div class="ac-crop-header"><div><h3 id="ac-crop-title">تنظیم تصویر پروفایل</h3><p>کادر برش همیشه مربع ۱:۱ است؛ تصویر را جابه‌جا یا بزرگ‌نمایی کن.</p></div><button type="button" class="ac-crop-close" aria-label="بستن">×</button></div><div class="ac-crop-stage"><img class="ac-crop-source" alt="پیش‌نمایش برش تصویر"></div><div class="ac-crop-actions"><button type="button" class="ac-crop-zoom" data-zoom="-0.1" aria-label="کوچک‌نمایی">−</button><button type="button" class="ac-crop-zoom" data-zoom="0.1" aria-label="بزرگ‌نمایی">＋</button><span class="ac-crop-ratio">نسبت تصویر ۱:۱</span><button type="button" class="ac-crop-cancel">انصراف</button><button type="button" class="ac-crop-confirm">تأیید برش</button></div></div>';
 document.body.appendChild(modal);
 const image=modal.querySelector(".ac-crop-source");
 const close=()=>{if(cropper){cropper.destroy();cropper=null}modal.remove();};
 modal.querySelector(".ac-crop-close").onclick=close;
 modal.querySelector(".ac-crop-cancel").onclick=close;
 modal.addEventListener("click",e=>{if(e.target===modal)close()});
 const escHandler=e=>{if(e.key==="Escape"&&document.body.contains(modal)){close();document.removeEventListener("keydown",escHandler)}};
 document.addEventListener("keydown",escHandler);
 await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error("خواندن تصویر انتخاب‌شده انجام نشد."));image.src=sourceUrl;});
 cropper=new window.Cropper(image,{aspectRatio:1,viewMode:1,dragMode:"move",autoCropArea:.88,background:false, responsive:true,restore:false,checkOrientation:true, guides:true,center:true,highlight:false, cropBoxMovable:false,cropBoxResizable:false,toggleDragModeOnDblclick:false,ready(){modal.classList.add("is-open")}});
 modal.querySelectorAll("[data-zoom]").forEach(b=>b.addEventListener("click",()=>cropper&&cropper.zoom(Number(b.dataset.zoom))));
 modal.querySelector(".ac-crop-confirm").onclick=()=>{
  if(!cropper)return;
  cropper.getCroppedCanvas({width:512,height:512,fillColor:"#ffffff",imageSmoothingEnabled:true,imageSmoothingQuality:"high"}).toBlob(blob=>{
   if(!blob){notice(noticeEl,"ساخت تصویر برش‌خورده انجام نشد.","error");return}
   croppedBlob=blob;show(URL.createObjectURL(blob));notice(noticeEl,"برش مربع آماده است؛ برای ثبت نهایی «ذخیره تصویر» را بزن.","success");close();
  },"image/jpeg",.92);
 };
};
file.addEventListener("change",async()=>{const f=file.files?.[0];if(!f)return;try{await openCropper(f)}catch(err){notice(noticeEl,err.message||"باز کردن ابزار برش انجام نشد.","error");file.value=""}});
card.querySelector("#ac-avatar-form").addEventListener("submit",async e=>{
 e.preventDefault();
 if(!croppedBlob)return notice(noticeEl,"ابتدا تصویر را انتخاب کن و برش مربع ۱:۱ را تأیید کن.","error");
 const btn=card.querySelector('button[type="submit"]');btn.disabled=true;
 try{
  const path=user.id+"/avatar.jpg";
  const {error:upErr}=await sb.storage.from("user-avatars").upload(path,croppedBlob,{upsert:true,contentType:"image/jpeg",cacheControl:"3600"});
  if(upErr)throw upErr;
  const {data}=sb.storage.from("user-avatars").getPublicUrl(path);
  const avatar_url=data.publicUrl+"?v="+Date.now();
  const {data:updated,error}=await sb.auth.updateUser({data:{...user.user_metadata,avatar_url}});
  if(error)throw error;
  currentUser=updated.user;profile=await getProfile(currentUser);
  const {error:profileErr}=await sb.from("user_profiles").upsert({user_id:user.id,display_name:profile?.display_name||user.user_metadata?.full_name||user.email.split("@")[0],avatar_url,updated_at:new Date().toISOString()},{onConflict:"user_id"});
  if(profileErr)throw profileErr;
  existing=avatar_url;croppedBlob=null;file.value="";show(avatar_url);drawFormTop();
  notice(noticeEl,"تصویر پروفایل با برش ۱:۱ ذخیره شد.","success");await loadComments();
 }catch(err){notice(noticeEl,err.message||"ذخیره تصویر انجام نشد.","error")}finally{btn.disabled=false}
});
card.querySelector("#ac-avatar-remove").addEventListener("click",async()=>{
 if(!existing)return notice(noticeEl,"تصویری برای حذف وجود ندارد.");
 const {data:updated,error}=await sb.auth.updateUser({data:{...user.user_metadata,avatar_url:null}});
 if(error)return notice(noticeEl,error.message,"error");
 currentUser=updated.user;existing=null;croppedBlob=null;file.value="";profile=await getProfile(currentUser);
 const {error:profileErr}=await sb.from("user_profiles").upsert({user_id:user.id,display_name:profile?.display_name||user.user_metadata?.full_name||user.email.split("@")[0],avatar_url:null,updated_at:new Date().toISOString()},{onConflict:"user_id"});
 if(profileErr)return notice(noticeEl,profileErr.message,"error");
 show(null);drawFormTop();notice(noticeEl,"تصویر پروفایل حذف شد.","success");await loadComments();
});
}
async function init(){const {data:{session}}=await sb.auth.getSession();currentUser=session?.user||null;if(currentUser){profile=await getProfile(currentUser);await syncProfile(currentUser,profile?.avatar_url)}drawFormTop();const form=document.querySelector("#profileForm");if(form)form.addEventListener("submit",async()=>{setTimeout(async()=>{const {data:{session:s}}=await sb.auth.getSession();if(s?.user){currentUser=s.user;profile=await getProfile(currentUser);const name=document.querySelector("#profileName")?.value?.trim()||s.user.user_metadata?.full_name||"کاربر";await sb.from("user_profiles").upsert({user_id:s.user.id,display_name:name.slice(0,80),avatar_url:profile?.avatar_url||s.user.user_metadata?.avatar_url||null,updated_at:new Date().toISOString()},{onConflict:"user_id"});profile=await getProfile(s.user);drawFormTop()}},500)});if(document.querySelector("#profilePanel")&&currentUser)setupAvatarSettings(currentUser);if(!document.querySelector("#profilePanel")){mountComments();await loadComments()}sb.auth.onAuthStateChange(async(_event,s)=>{currentUser=s?.user||null;profile=currentUser?await getProfile(currentUser):null;drawFormTop();if(currentUser&&document.querySelector("#profilePanel"))setupAvatarSettings(currentUser);if(!document.querySelector("#profilePanel"))await loadComments()})}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();