(()=>{
const API="https://srfldjfrzmtnlabusssq.supabase.co/functions/v1/discount-validate",KEY="sb_publishable_UW2Wzzp8Y-KKd82nZHQUKA_RGl876RB";
let applied=null,busy=false;
const style=document.createElement("style");style.textContent=`
.coupon-box{margin:18px 0 12px;padding:16px;border:1px solid rgba(217,255,114,.22);border-radius:16px;background:linear-gradient(135deg,rgba(217,255,114,.07),rgba(182,160,255,.05))}
.coupon-explain{margin:0 0 10px;color:#b8bac3;font-size:12px;line-height:2}.coupon-explain strong{display:block;color:#e7edcf;font-weight:600;margin-top:4px}
.coupon-row{display:flex;gap:8px;align-items:center}.coupon-row input{min-width:0;flex:1;text-align:left;direction:ltr;text-transform:uppercase}.coupon-row button{flex-shrink:0;padding:11px 16px;border:1px solid #d9ff7270;border-radius:12px;background:#d9ff72;color:#10120c;font-weight:800;font-size:12px;cursor:pointer}
.coupon-feedback{min-height:20px;margin:7px 0 0;color:#aeb4a0;font-size:12px}.coupon-feedback.success{color:#d9ff72}.coupon-feedback.error{color:#ff9a9a}
@media(max-width:480px){.coupon-row{align-items:stretch}.coupon-row button{padding-inline:12px}}
`;document.head.append(style);
function setup(){
 const email=document.getElementById("clientEmail"),service=document.getElementById("serviceSelect");
 if(!email||!service||document.getElementById("discountCode"))return false;
 const box=document.createElement("div");box.className="coupon-box";box.innerHTML='<p class="coupon-explain">اگر کد تخفیف اینستاگرام یا کد اختصاصی داری، اینجا وارد کن. <strong>درصد تخفیف پس از قیمت‌گذاری و اعلام قیمت نهایی پروژه، از همان مبلغ کسر می‌شود.</strong></p><div class="coupon-row"><input id="discountCode" type="text" maxlength="32" placeholder="کد تخفیف" dir="ltr" autocomplete="off" aria-label="کد تخفیف"><button type="button" id="applyDiscount">اعمال کد</button></div><p id="discountFeedback" class="coupon-feedback" role="status" aria-live="polite"></p>';
 email.insertAdjacentElement("afterend",box);
 const code=document.getElementById("discountCode"),feedback=document.getElementById("discountFeedback"),button=document.getElementById("applyDiscount");
 const message=(s,type)=>{feedback.textContent=s;feedback.className="coupon-feedback"+(type?" "+type:"")};
 async function apply(){
  const value=code.value.trim().toUpperCase();if(!value){applied=null;message("کد تخفیف را وارد کن.","error");return null}
  button.disabled=true;message("در حال بررسی کد تخفیف…");
  try{const response=await window.__alishamsNativeFetch(API,{method:"POST",headers:{"Content-Type":"application/json","apikey":KEY},body:JSON.stringify({code:value,service:service.value})});const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||"کد تخفیف معتبر نیست.");applied={code:data.code,percent:data.percent};code.value=data.code;message("کد تخفیف فعال شد؛ "+data.percent+"٪ پس از اعلام قیمت نهایی از مبلغ کسر می‌شود.","success");return applied}
  catch(e){applied=null;message(e.message||"بررسی کد تخفیف انجام نشد.","error");return null}
  finally{button.disabled=false}
 }
 button.addEventListener("click",apply);code.addEventListener("input",()=>{applied=null;message("")});
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