self.addEventListener("install",event=>{self.skipWaiting()});
self.addEventListener("activate",event=>{event.waitUntil(self.clients.claim())});
self.addEventListener("push",event=>{
 let data={title:"اعلان جدید",body:"یک به‌روزرسانی در حساب کاربری شما وجود دارد.",url:"/account.html"};
 try{if(event.data)data={...data,...event.data.json()}}catch(_){}
 event.waitUntil(self.registration.showNotification(data.title||"اعلان جدید",{
  body:data.body||"",icon:"/favicon-32x32.png",badge:"/favicon-32x32.png",
  tag:data.tag||"alishams-notification",renotify:false,
  data:{url:data.url||"/account.html"},dir:"rtl",lang:"fa"
 }));
});
self.addEventListener("notificationclick",event=>{
 event.notification.close();
 const target=new URL(event.notification.data?.url||"/account.html",self.location.origin).href;
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  for(const client of windows){if(new URL(client.url).origin===self.location.origin){await client.focus();if("navigate" in client)await client.navigate(target);return}}
  await self.clients.openWindow(target);
 })());
});