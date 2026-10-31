(function(){
'use strict';
const HEADER_ID='alishamsSharedHeader';
const markup =
'<header id="alishamsSharedHeader" class="topbar site-shared-header">'+
'<div class="wrap nav site-shared-nav">'+
'<a class="brand" href="/" aria-label="علی شمس"><span class="brand-mark brand-logo"><img src="/assets/images/alishams-studio-logo.png" alt="لوگوی علی شمس" decoding="async"></span><span>علی شمس<small>Alishams DIGITAL STUDIO</small></span></a>'+
'<nav class="navlinks" id="alishamsSharedNav" aria-label="ناوبری اصلی">'+
'<a href="/#services">خدمات</a><a href="/portfolio.html">نمونه‌کارها</a><a href="/videos.html">ویدئوها</a><a href="/about.html">درباره من</a>'+
'<div class="nav-dropdown"><button class="nav-dropdown-toggle" type="button" aria-expanded="false">همکاری <span aria-hidden="true">⌄</span></button><div class="nav-dropdown-menu"><a href="/pricing.html">قیمت‌گذاری</a><a href="/packages.html">پکیج‌های فروشگاهی</a><a href="/#reviews">رویکرد کاری</a><a href="/#trust">شفافیت همکاری</a><a href="/contact-center.html">مرکز گفت‌وگو</a></div></div>'+
'<div class="nav-dropdown"><button class="nav-dropdown-toggle" type="button" aria-expanded="false">پیگیری <span aria-hidden="true">⌄</span></button><div class="nav-dropdown-menu"><a href="/project-tracking.html">پیگیری پروژه</a><a href="/order-tracking.html">پیگیری سفارش</a><a href="/account.html">حساب کاربری</a></div></div>'+
'<div class="nav-dropdown"><button class="nav-dropdown-toggle" type="button" aria-expanded="false">پرسش و گفت‌وگو <span aria-hidden="true">⌄</span></button><div class="nav-dropdown-menu"><a href="/#faq">پرسش‌های متداول</a><a href="/#conversation">گفت‌وگو</a></div></div>'+
'</nav><div class="nav-actions"><button class="menu-toggle" id="alishamsSharedMenuToggle" type="button" aria-label="باز کردن منو" aria-expanded="false"><span class="header-control-icon" aria-hidden="true">☰</span><span class="header-control-label">منو</span></button>'+
'<a class="account-cta" id="alishamsSharedAccount" href="/login.html" aria-label="ورود به حساب کاربری و ثبت‌نام" title="ورود به حساب کاربری و ثبت‌نام">'+
'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-1.5a4.5 4.5 0 0 0-4.5-4.5h-7A4.5 4.5 0 0 0 4 19.5V21"/><circle cx="12" cy="7.5" r="4"/><path d="M18.5 8.5h3m-1.5-1.5v3"/></svg>'+
'<span class="account-cta-label">حساب کاربری</span><span class="account-cta-status" hidden>واردشده‌اید</span></a></div></div></header>';
function install(){
 if(document.getElementById(HEADER_ID))return;
 const existing=document.querySelector('header');
 const template=document.createElement('template');template.innerHTML=markup.trim();
 const header=template.content.firstElementChild;
 if(existing)existing.replaceWith(header);else if(document.body)document.body.insertBefore(header,document.body.firstChild);
 const nav=document.getElementById('alishamsSharedNav'),menu=document.getElementById('alishamsSharedMenuToggle'),account=document.getElementById('alishamsSharedAccount');
 if(!nav||!menu||!account)return;
 const closeMenu=()=>{nav.classList.remove('open');menu.setAttribute('aria-expanded','false');const icon=menu.querySelector('.header-control-icon');if(icon)icon.textContent='☰';};
 menu.addEventListener('click',()=>{const opened=nav.classList.toggle('open');menu.setAttribute('aria-expanded',String(opened));const icon=menu.querySelector('.header-control-icon');if(icon)icon.textContent=opened?'×':'☰';});
 nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));
 const dropdowns=[...nav.querySelectorAll('.nav-dropdown')];
 dropdowns.forEach(drop=>{const toggle=drop.querySelector('.nav-dropdown-toggle');toggle.addEventListener('click',e=>{e.stopPropagation();const opening=!drop.classList.contains('open');dropdowns.forEach(other=>{other.classList.remove('open');other.querySelector('.nav-dropdown-toggle').setAttribute('aria-expanded','false');});drop.classList.toggle('open',opening);toggle.setAttribute('aria-expanded',String(opening));});});
 document.addEventListener('click',e=>{if(!e.target.closest('#alishamsSharedNav'))dropdowns.forEach(drop=>{drop.classList.remove('open');drop.querySelector('.nav-dropdown-toggle').setAttribute('aria-expanded','false');});});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeMenu();dropdowns.forEach(drop=>{drop.classList.remove('open');drop.querySelector('.nav-dropdown-toggle').setAttribute('aria-expanded','false');});}});
 (async()=>{try{
   const mod=await import('https://esm.sh/@supabase/supabase-js@2');
   const client=mod.createClient('https://srfldjfrzmtnlabusssq.supabase.co','sb_publishable_UW2Wzzp8Y-KKd82nZHQUKA_RGl876RB');
   const {data,error}=await client.auth.getSession();if(error)throw error;
   if(data&&data.session){account.classList.add('is-authenticated');account.href='/account.html';account.setAttribute('aria-label','حساب کاربری؛ واردشده‌اید');account.title='حساب کاربری — واردشده‌اید';const status=account.querySelector('.account-cta-status');if(status)status.hidden=false;}
   else{account.classList.remove('is-authenticated');account.href='/login.html';account.setAttribute('aria-label','ورود به حساب کاربری و ثبت‌نام');account.title='ورود به حساب کاربری و ثبت‌نام';const status=account.querySelector('.account-cta-status');if(status)status.hidden=true;}
 }catch(error){console.warn('Alishams account status unavailable',error);}})();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();