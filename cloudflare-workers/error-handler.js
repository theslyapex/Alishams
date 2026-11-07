const DATA = {
  403: ["دسترسی به این بخش امکان‌پذیر نیست", "این درخواست به دلایل امنیتی یا محدودیت دسترسی اجازه عبور نگرفت.", "اگر فکر می‌کنی این محدودیت اشتباه است، از مرکز ارتباط با ما پیام بفرست.", "محدودیت دسترسی"],
  404: ["این صفحه در مسیر ما پیدا نشد.", "احتمالاً نشانی صفحه تغییر کرده یا لینک موردنظر دیگر در دسترس نیست. نگران نباش؛ می‌توانی از مسیرهای اصلی سایت ادامه بدهی.", "اگر از لینک داخلی به این صفحه رسیده‌ای، خوشحال می‌شوم اطلاع بدهی.", "صفحه پیدا نشد"],
  500: ["یک خطای داخلی رخ داده است", "در پردازش درخواست مشکلی پیش آمد و امکان تکمیل آن وجود نداشت.", "چند لحظه دیگر دوباره تلاش کن. اگر مشکل ادامه داشت، با ما تماس بگیر.", "خطای داخلی سرور"],
  502: ["ارتباط با سرور برقرار نشد", "در حال حاضر پاسخ معتبری از یکی از سرورهای مسیر دریافت نکردیم.", "این اختلال ممکن است موقتی باشد؛ کمی بعد دوباره تلاش کن.", "درگاه نامعتبر"],
  503: ["سرویس موقتاً در دسترس نیست", "در حال حاضر سرویس برای انجام برخی عملیات آماده نیست.", "لطفاً کمی بعد دوباره مراجعه کن.", "سرویس موقتاً خارج از دسترس"],
  504: ["پاسخ سرور بیش از حد طول کشید", "زمان انتظار برای دریافت پاسخ به پایان رسید.", "اتصال ممکن است موقتاً کند یا ناپایدار باشد. دوباره تلاش کن.", "پایان مهلت انتظار"]
};
function render(status) {
  const [title, desc, help, label] = DATA[status] || DATA[500];
  const n = String(status);
  const retry = [502, 503, 504].includes(status);
  const html = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#090a0d"><meta name="robots" content="noindex,nofollow">
<title>${n} · ${title} | علی شمس — Alishams Studio</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Estedad:wght@300;400;500;600;700;800;900&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root{color-scheme:dark;--bg:#090a0d;--ink:#f5f3ee;--muted:#a5a5ad;--line:rgba(255,255,255,.11);--lime:#d9ff72;--lav:#b6a0ff;--coral:#ff8e75}
*{box-sizing:border-box;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
html,body{margin:0;min-height:100%;background:var(--bg);color:var(--ink);font-family:Estedad,Tahoma,sans-serif}
body{min-height:100vh;overflow-x:hidden;background:radial-gradient(ellipse at 15% 18%,#b6a0ff18,transparent 34%),radial-gradient(ellipse at 86% 62%,#d9ff7210,transparent 32%),linear-gradient(145deg,#090a0d,#0d0f14 55%,#090a0d)}
.page{width:min(1160px,calc(100% - 48px));min-height:calc(100vh - 80px);margin:auto;display:grid;place-items:center;padding:58px 0 76px}
.layout{width:100%;display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.82fr);align-items:center;gap:clamp(34px,7vw,100px)}
.copy{position:relative;z-index:2}.brand{display:inline-flex;align-items:center;gap:10px;color:var(--lime);font:800 11px/1.5 Manrope,Estedad,sans-serif;letter-spacing:1.7px;direction:ltr}
.brand:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--lime);box-shadow:0 0 18px #d9ff72a0}
.pill{display:table;margin-top:25px;padding:7px 13px;border:1px solid var(--line);border-radius:30px;color:#c4c5cc;font-size:11px}
h1{margin:19px 0 12px;font-size:clamp(31px,4.4vw,53px);line-height:1.55;font-weight:800;letter-spacing:-1px}
h1 span{color:var(--lime)}.lead{max-width:510px;margin:0;color:#b7b8c0;font-size:15px;line-height:2.25}
.help{display:flex;align-items:center;gap:10px;margin-top:22px;color:#858791;font-size:11px;line-height:2}.help:before{content:"";width:26px;height:1px;background:var(--lav);flex:none}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}
.btn{min-height:49px;display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:10px 19px;border:1px solid var(--line);border-radius:14px;background:transparent;color:var(--ink);font:700 13px Estedad,Tahoma,sans-serif;text-decoration:none;transition:transform .25s,border-color .25s}
.btn:hover{transform:translateY(-3px);border-color:#d9ff7277}.primary{background:var(--lime);border-color:var(--lime);color:#11130b}
.visual{position:relative;min-height:390px;display:grid;place-items:center;isolation:isolate}
.visual:before,.visual:after{content:"";position:absolute;z-index:-1;width:290px;height:290px;border:1px solid #d9ff7222;border-radius:50%;box-shadow:0 0 0 38px #d9ff7208,0 0 0 76px #b6a0ff08}
.visual:after{width:390px;height:150px;border-color:#b6a0ff40;transform:rotate(-31deg);box-shadow:none}
.card{position:relative;width:min(100%,390px);padding:17px;border:1px solid #ffffff20;border-radius:24px;background:linear-gradient(145deg,#191c24ef,#101116ef);box-shadow:0 35px 90px #0009,0 0 55px #b6a0ff12;backdrop-filter:blur(18px);transform:rotate(-3deg)}
.top,.bottom{display:flex;align-items:center;justify-content:space-between;direction:ltr;color:#858994;font:10px Manrope,Arial,sans-serif;letter-spacing:1px}
.top{padding:0 2px 14px;border-bottom:1px solid #ffffff12}.dots{display:flex;gap:6px}.dots b{width:7px;height:7px;border-radius:50%;background:#555965}.dots b:first-child{background:var(--coral)}.dots b:nth-child(2){background:#e6c779}.dots b:nth-child(3){background:var(--lime)}
.art{position:relative;min-height:245px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;overflow:hidden}
.art:before{content:"";position:absolute;inset:0;background-image:linear-gradient(#ffffff0b 1px,transparent 1px),linear-gradient(90deg,#ffffff0b 1px,transparent 1px);background-size:25px 25px;mask-image:radial-gradient(ellipse,#000 20%,transparent 76%)}
.digit-top{position:relative;z-index:1;color:var(--lime);font:900 clamp(80px,11vw,112px)/.9 Manrope,sans-serif;text-shadow:0 12px 45px #0009}
.digit-bottom{position:relative;z-index:1;color:var(--lav);font:800 clamp(66px,9vw,92px)/.95 Manrope,sans-serif;letter-spacing:3px;text-shadow:0 12px 45px #0009}
.bottom{padding:12px 3px 0;border-top:1px solid #ffffff12;color:#8f929b;font-size:9px}.bottom strong{color:var(--lime);font-weight:700}
.orbit{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.orbit i{position:absolute;width:8px;height:8px;border-radius:50%;background:var(--lime);box-shadow:0 0 18px #d9ff72}.orbit i:nth-child(1){top:15%;right:15%}.orbit i:nth-child(2){bottom:18%;left:8%;width:6px;height:6px;background:var(--lav);box-shadow:0 0 18px var(--lav)}.orbit i:nth-child(3){top:24%;left:13%;width:4px;height:4px;background:var(--coral);box-shadow:0 0 18px var(--coral)}
footer{width:min(1160px,calc(100% - 48px));margin:0 auto;padding:18px 0 24px;border-top:1px solid #ffffff10;display:flex;justify-content:space-between;gap:18px;color:#777a84;font-size:11px}
footer a{color:#b7b8c0;text-decoration:none}footer a:hover{color:var(--lime)}
@media(max-width:760px){.page{width:calc(100% - 36px);min-height:auto;padding:38px 0 42px}.layout{grid-template-columns:1fr;gap:12px}.copy{text-align:center}.pill{margin:18px auto 0}.lead{margin-inline:auto}.actions{justify-content:center}.help{justify-content:center}.visual{min-height:300px;grid-row:1}.card{width:min(88%,360px)}.art{min-height:205px}.visual:before{width:230px;height:230px}.visual:after{width:290px;height:110px}footer{width:calc(100% - 36px);flex-direction:column;align-items:center;text-align:center;gap:6px}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{transition:none!important}}
</style></head>
<body><main class="page"><section class="layout" aria-labelledby="title">
<div class="copy"><span class="brand">ALISHAMS DIGITAL STUDIO · HTTP ${n}</span><div class="pill">${label}</div>
<h1 id="title">${title}</h1><p class="lead">${desc}</p><p class="help">${help}</p>
<div class="actions"><a class="btn primary" href="${retry?'#retry':'/'}" ${retry?'onclick="location.reload();return false"':''}>${retry?'تلاش دوباره':'بازگشت به صفحه اصلی'}</a><a class="btn" href="/contact-center.html">مرکز ارتباط با ما</a></div></div>
<div class="visual" aria-hidden="true"><div class="orbit"><i></i><i></i><i></i></div><div class="card">
<div class="top"><span>ALISHAMS / PAGE ROUTE</span><span class="dots"><b></b><b></b><b></b></span></div>
<div class="art"><span class="digit-top">${n[0]}</span><span class="digit-bottom">${n.slice(1)}</span></div>
<div class="bottom"><span>REQUEST STATUS</span><strong>HTTP ${n}</strong></div></div></div>
</section></main><footer><span>© 2026 علی شمس · Alishams Digital Studio</span><span><a href="/">صفحه اصلی</a>　·　<a href="/portfolio.html">نمونه‌کارها</a>　·　<a href="/about.html">درباره من</a></span></footer>
<script>(function(){const stop=e=>e.preventDefault();["contextmenu","copy","cut","selectstart","dragstart"].forEach(t=>document.addEventListener(t,stop,true));document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&["a","c","x"].includes(e.key.toLowerCase()))e.preventDefault()},true)})();</script></body></html>`;
  return new Response(html,{status,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-alishams-error-handler":"worker"}});
}
export default {async fetch(request){try{const response=await fetch(request);if(DATA[response.status])return render(response.status);return response;}catch(e){return render(502);}}};
