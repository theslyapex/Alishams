const SB_URL="https://srfldjfrzmtnlabusssq.supabase.co";
const SB_KEY="sb_publishable_UW2Wzzp8Y-KKd82nZHQUKA_RGl876RB";
const PORTFOLIO_CONFIG={url:SB_URL,key:SB_KEY,bucket:"portfolio-images"};
let portfolioSB;
async function getPortfolioSB(){if(!portfolioSB){const m=await import("https://esm.sh/@supabase/supabase-js@2");portfolioSB=m.createClient(SB_URL,SB_KEY);}return portfolioSB;}
function escapeHTML(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function faNum(n){return new Intl.NumberFormat("fa-IR").format(Number(n)||0);}
function imageURL(sb,path){if(!path)return "";if(/^https?:\/\//i.test(path))return path;return sb.storage.from(PORTFOLIO_CONFIG.bucket).getPublicUrl(path).data.publicUrl;}
async function recordPageView(page){try{const sb=await getPortfolioSB();await sb.rpc("record_portfolio_page_view",{p_page_key:page});}catch(e){console.warn("Portfolio view counter unavailable",e);}}
async function loadGallery(category){
 const sb=await getPortfolioSB(); const grid=document.getElementById("galleryGrid");
 try{
  const [{data:items,error},pageStats]=await Promise.all([
   sb.from("portfolio_items").select("id,category,title,description,image_path,cover_path,created_at,view_count").eq("category",category).eq("published",true).order("created_at",{ascending:false}),
   sb.rpc("get_portfolio_page_view_count",{p_page_key:category})
  ]);
  if(error)throw error;
  const total=items.reduce((n,x)=>n+(Number(x.view_count)||0),0);
  document.getElementById("pageViews").textContent=faNum(pageStats.data||0);
  document.getElementById("itemViews").textContent=faNum(total);
  document.getElementById("itemCount").textContent=faNum(items.length);
  document.getElementById("sortOrder")?.addEventListener("change",()=>render(items,category,sb),{once:true});
  window.__portfolioItems=items;window.__portfolioCategory=category;document.body.dataset.portfolioCategory=category;render(items,category,sb);
 }catch(e){grid.innerHTML='<div class="empty">اتصال به پایگاه داده هنوز آماده نیست. ابتدا فایل <b>portfolio-backend-setup.sql</b> را در SQL Editor پروژه Supabase اجرا کنید.<br><small>'+escapeHTML(e.message||"")+'</small></div>';}
}
function render(items,category,sb){
 const grid=document.getElementById("galleryGrid");const sort=document.getElementById("sortOrder")?.value||"new";
 const list=[...items].sort((a,b)=>sort==="views"?(b.view_count||0)-(a.view_count||0):sort==="old"?new Date(a.created_at)-new Date(b.created_at):new Date(b.created_at)-new Date(a.created_at));
 if(!list.length){grid.innerHTML='<div class="empty">هنوز نمونه‌کاری منتشر نشده است. به‌زودی این گالری تکمیل می‌شود.</div>';return;}
 grid.innerHTML=list.map(x=>'<article class="card"><div class="cover" role="button" tabindex="0" data-open="'+x.id+'" aria-label="نمایش '+escapeHTML(x.title)+'"><img loading="lazy" src="'+escapeHTML(imageURL(sb,x.cover_path||x.image_path))+'" alt="'+escapeHTML(x.title)+'"><span class="views">◉ '+faNum(x.view_count)+' بازدید</span><span class="cover-hint">مشاهده پروژه ↗</span></div><div class="cardbody"><h2>'+escapeHTML(x.title)+'</h2><p>'+escapeHTML(x.description||"")+'</p><div class="meta"><span>'+new Date(x.created_at).toLocaleDateString("fa-IR")+'</span></div><button type="button" class="details-btn" data-open="'+x.id+'">مشاهده جزئیات بیشتر <span aria-hidden="true">↗</span></button></div></article>').join("");

}
async function openPortfolioItem(id,category,sb){
 const item=(window.__portfolioItems||[]).find(x=>String(x.id)===String(id));if(!item){console.error("Portfolio item not found:",id);return;}
 const modal=document.getElementById("imageModal");if(!modal){console.error("Portfolio details modal #imageModal is missing");return;}
 try{await sb.rpc("record_portfolio_item_view",{p_item_id:id});item.view_count=(Number(item.view_count)||0)+1;}catch(e){console.warn(e)}
 const image=modal.querySelector(".modalbox>img"),title=modal.querySelector(".modalhead h2"),description=modal.querySelector(".modalhead p"),views=modal.querySelector("[data-modal-views");
 if(!image||!title||!description||!views){console.error("Portfolio modal markup is incomplete");return;}
 image.src=imageURL(sb,item.image_path||item.cover_path);image.alt=item.title;title.textContent=item.title;description.textContent=item.description||"";views.textContent=faNum(item.view_count)+" بازدید";modal.classList.add("open");modal.setAttribute("aria-hidden","false");document.body.style.overflow="hidden";
}
function closePortfolioModal(){const m=document.getElementById("imageModal");if(m){m.classList.remove("open");m.setAttribute("aria-hidden","true");document.body.style.overflow="";}}
document.addEventListener("click",e=>{
 const opener=e.target.closest("#galleryGrid [data-open]");
 if(opener){e.preventDefault();e.stopPropagation();const sb=portfolioSB;if(!sb){getPortfolioSB().then(client=>openPortfolioItem(opener.dataset.open,document.body.dataset.portfolioCategory||window.__portfolioCategory||"",client)).catch(err=>console.error("Could not open portfolio details",err));return;}openPortfolioItem(opener.dataset.open,document.body.dataset.portfolioCategory||window.__portfolioCategory||"",sb).catch(err=>console.error("Could not open portfolio details",err));return;}
 if(e.target.closest("[data-close-modal]")||e.target.id==="imageModal")closePortfolioModal();
});
document.addEventListener("keydown",e=>{if((e.key==="Enter"||e.key===" ")&&e.target.matches("#galleryGrid [role=button][data-open]")){e.preventDefault();e.target.click();}});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closePortfolioModal();});

export { getPortfolioSB, recordPageView, loadGallery, render, portfolioSB };
