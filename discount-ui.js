(()=>{
const API="https://srfldjfrzmtnlabusssq.supabase.co/functions/v1/discount-validate",KEY="sb_publishable_UW2Wzzp8Y-KKd82nZHQUKA_RGl876RB";
let applied=null,busy=false;
const style=document.createElement("style");style.textContent=`
.coupon-box{margin:18px 0 12px;padding:16px;border:1px solid rgba(217,255,114,.22);border-radius:16px;background:linear-gradient(135deg,rgba(217,255,114,.07),rgba(182,160,255,.05))}
.coupon-explain{margin:0 0 10px;color:#b8bac3;font-size:12px;line-height:2}.coupon-explain strong{display:block;color:#e7edcf;font-weight:600;margin-top:4px}
.coupon-row{display:flex;gap:8px;align-items:center}.coupon-row input{min-width:0;flex:1;text-align:left;direction:ltr;text-transform:uppercase}.coupon-row button{flex-shrink:0;padding:11px 16px;border:1px solid #d9ff7270;border-radius:12px;background:#d9ff72;color:#10120c;font-weight:800;font-size:12px;cursor:pointer}
.coupon-feedback{min-height:20px;margin:7px 0 0;color:#aeb4a0;font-size:12px}.coupon-feedback.success{color:#d9ff72}.coupon-feedback.error{color:#ff9a9a}\n.plus-order-status{display:none;margin:0 0 12px;padding:13px 14px;border:1px solid rgba(182,160,255,.38);border-radius:13px;background:linear-gradient(120deg,rgba(182,160,255,.14),rgba(217,255,114,.07));color:#e8e0ff;font-size:12px;line-height:2}.plus-order-status.is-active{display:block}.plus-order-status strong{display:block;color:#d9ff72;font-size:13px}.plus-order-status small{display:block;color:#c6bfd8;font-size:11px}.plus-order-success{margin:14px 0;padding:13px 15px;border:1px solid rgba(182,160,255,.48);border-radius:13px;background:linear-gradient(120deg,rgba(182,160,255,.16),rgba(217,255,114,.07));color:#f2edff;font-size:13px;line-height:2}.plus-order-success strong{color:#d9ff72}
@media(max-width:480px){.coupon-row{align-items:stretch}.coupon-row button{padding-inline:12px}}
`;document.head.append(style);
function setup(){
 const email=document.getElementById("clientEmail"),service=document.getElementById("serviceSelect");
 if(!email||!service||document.getElementById("discountCode"))return false;
 const box=document.createElement("div");box.className="coupon-box";box.innerHTML='<p class="coupon-explain">اگر کد تخفیف اینستاگرام یا کد اختصاصی داری، اینجا وارد کن. <strong>درصد تخفیف پس از قیمت‌گذاری و اعلام قیمت نهایی پروژه، از همان مبلغ کسر می‌شود.</strong></p><div class="coupon-row"><input id="discountCode" type="text" maxlength="32" placeholder="کد تخفیف" dir="ltr" autocomplete="off" aria-label="کد تخفیف"><button type="button" id="applyDiscount">اعمال کد</button></div><p id="discountFeedback" class="coupon-feedback" role="status" aria-live="polite"></p>';
 email.insertAdjacentElement("afterend",box);\n const plusStatus=document.createElement("div");plusStatus.className="plus-order-status";plusStatus.id="plusOrderStatus";plusStatus.setAttribute("role","status");plusStatus.setAttribute("aria-live","polite");plusStatus.innerHTML="<strong>عضویت پلاس+ فعال است</strong><span id=\"plusOrderStatusText\"></span><small>تخفیف پس از ثبت سفارش در اطلاعات درخواست ذخیره می‌شود.</small>";box.insertBefore(plusStatus,box.firstChild);
 const code=document.getElementById("discountCode"),feedback=document.getElementById("discountFeedback"),button=document.getElementById("applyDiscount");
 const message=(s,type)=>{feedback.textContent=s;feedback.className="coupon-feedback"+(type?" "+type:"")};
 async function apply(){
  const value=code.value.trim().toUpperCase();if(!value){applied=null;message("کد تخفیف را وارد کن.","error");return null}
  button.disabled=true;message("در حال بررسی کد تخفیف…");
  try{const response=await window.__alishamsNativeFetch(API,{method:"POST",headers:{"Content-Type":"application/json","apikey":KEY},body:JSON.stringify({code:value,service:service.value})});const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||"کد تخفیف معتبر نیست.");applied={code:data.code,percent:data.percent};code.value=data.code;message("کد تخفیف فعال شد؛ "+data.percent+"٪ پس از اعلام قیمت نهایی از مبلغ کسر می‌شود.","success");return applied}
  catch(e){applied=null;message(e.message||"بررسی کد تخفیف انجام نشد.","error");return null}
  finally{button.disabled=false}
 }
 button.addEventListener("click",apply);code.addEventListener("input",()=>{applied=null;message("")});\n async function refreshPlusStatus(){try{const token=await window.customerSessionToken?.(),accountEmail=await window.customerSessionEmail?.();if(!token||!accountEmail||String(email.value||"").trim().toLowerCase()!==String(accountEmail).trim().toLowerCase()){plusStatus.classList.remove("is-active");return}const r=await window.__alishamsNativeFetch("https://srfldjfrzmtnlabusssq.supabase.co/functions/v1/plus-membership",{method:"POST",headers:{"Content-Type":"application/json","apikey":KEY,"Authorization":"Bearer "+token},body:JSON.stringify({action:"status"})});const d=await r.json(),m=d?.membership;if(r.ok&&m?.is_active===true){const pct=Number(m.discount_percent)===50?50:35;document.getElementById("plusOrderStatusText").textContent=" "+pct+"٪ تخفیف ویژه شما در این سفارش در نظر گرفته می‌شود.";plusStatus.classList.add("is-active")}else plusStatus.classList.remove("is-active")}catch(e){plusStatus.classList.remove("is-active");console.warn("Plus order preview unavailable",e)}}\n email.addEventListener("change",refreshPlusStatus);email.addEventListener("blur",refreshPlusStatus);refreshPlusStatus();
 service.addEventListener("change",()=>{if(code.value.trim()){applied=null;message("خدمت تغییر کرد؛ کد تخفیف را دوباره بررسی کن.")}});
 window.__alishamsApplyDiscount=apply;window.__alishamsDiscountState=()=>applied;
 return true;
}
if(!setup()){const observer=new MutationObserver(()=>{if(setup())observer.disconnect()});observer.observe(document.documentElement,{childList:true,subtree:true});}
const nativeFetch=window.fetch.bind(window);window.__alishamsNativeFetch=nativeFetch;
window.fetch=async function(input,init={}){
 const url=typeof input==="string"?input:input?.url||"";
 if(url.includes("/functions/v1/order-submit")&&init.body){
  const code=document.getElementById("discountCode");
  if(code?.value.trim()){
   const state=window.__alishamsDiscountState?.();let coupon=state;
   if(!coupon||coupon.code!==code.value.trim().toUpperCase()){coupon=await window.__alishamsApplyDiscount?.();if(!coupon)throw new Error(document.getElementById("discountFeedback")?.textContent||"کد تخفیف معتبر نیست.")}
   const payload=JSON.parse(init.body);payload.discount_code=coupon.code;init={...init,body:JSON.stringify(payload)};
  }
 }
 return nativeFetch(input,init);
};
})();