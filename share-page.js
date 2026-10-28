(function(){
'use strict';
if(location.pathname==='/'||location.pathname==='/index.html'||document.getElementById('alishamsShareRoot'))return;
function init(){
 if(!document.body||document.getElementById('alishamsShareRoot'))return;
 var url=location.href.split('#')[0], title=(document.querySelector('meta[property="og:title"]')||{}).content||document.title||'Alishams';
 var encUrl=encodeURIComponent(url),encTitle=encodeURIComponent(title);
 var root=document.createElement('div');root.id='alishamsShareRoot';
 root.innerHTML='<button class="as-share-toggle" type="button" aria-expanded="false" aria-controls="asSharePanel"><span class="as-share-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="18" cy="5" r="3" stroke="currentColor" stroke-width="1.8"/><circle cx="6" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="19" r="3" stroke="currentColor" stroke-width="1.8"/><path d="m8.7 10.6 6.6-4.1M8.7 13.4l6.6 4.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span><span class="as-share-label"><strong>هم‌رسانی این صفحه</strong><small>برای دوستانتان بفرستید</small></span></button><section class="as-share-panel" id="asSharePanel" aria-label="هم‌رسانی صفحه"><div class="as-share-head"><div><strong>این صفحه را به اشتراک بگذارید</strong><p>محتوای مفید را با دوستانتان به اشتراک بگذارید.</p></div><button class="as-share-close" type="button" aria-label="بستن">×</button></div><div class="as-share-link"><span class="as-share-url"></span><button class="as-copy" type="button">کپی پیوند</button></div><div class="as-share-options"><button class="as-share-option" data-native="1" type="button"><img src="https://img.icons8.com/fluency/48/share-3.png" alt="" loading="lazy"><span>هم‌رسانی</span></button><a class="as-share-option" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text='+encTitle+'%20'+encUrl+'"><img src="https://img.icons8.com/fluency/48/whatsapp.png" alt="" loading="lazy"><span>واتساپ</span></a><a class="as-share-option" target="_blank" rel="noopener noreferrer" href="https://t.me/share/url?url='+encUrl+'&text='+encTitle+'"><img src="https://img.icons8.com/fluency/48/telegram-app.png" alt="" loading="lazy"><span>تلگرام</span></a><a class="as-share-option" target="_blank" rel="noopener noreferrer" href="mailto:?subject='+encTitle+'&body='+encUrl+'"><img src="https://img.icons8.com/fluency/48/new-post.png" alt="" loading="lazy"><span>ایمیل</span></a></div><div class="as-share-status" role="status" aria-live="polite"></div></section>';
 root.querySelector('.as-share-url').textContent=url;
 document.body.appendChild(root);
 var toggle=root.querySelector('.as-share-toggle'),status=root.querySelector('.as-share-status');
 function close(){root.classList.remove('is-open');toggle.setAttribute('aria-expanded','false')}
 toggle.addEventListener('click',function(){var open=!root.classList.contains('is-open');root.classList.toggle('is-open',open);toggle.setAttribute('aria-expanded',String(open))});
 root.querySelector('.as-share-close').addEventListener('click',close);
 document.addEventListener('keydown',function(e){if(e.key==='Escape')close()});
 root.addEventListener('click',async function(e){
  var copy=e.target.closest('.as-copy'),native=e.target.closest('[data-native]');
  if(copy){try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(url)}else{var t=document.createElement('textarea');t.value=url;t.style.position='fixed';t.style.opacity='0';document.body.appendChild(t);t.select();var ok=document.execCommand('copy');t.remove();if(!ok)throw Error('copy failed')}status.textContent='پیوند صفحه کپی شد.';copy.textContent='کپی شد ✓'}catch(err){status.textContent='کپی خودکار ممکن نشد؛ پیوند را انتخاب و کپی کنید.'}return}
  if(native){if(navigator.share){try{await navigator.share({title:title,text:'این صفحه را ببینید:',url:url});status.textContent=''}catch(err){if(err.name!=='AbortError')status.textContent='امکان هم‌رسانی در این مرورگر فراهم نیست.'}}else{try{await navigator.clipboard.writeText(url);status.textContent='پیوند صفحه کپی شد.'}catch(err){status.textContent='از گزینه کپی پیوند استفاده کنید.'}}}
 });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();