(() => {
  const SUPABASE_URL = "https://srfldjfrzmtnlabusssq.supabase.co";
  const SUPABASE_KEY = "sb_publishable_UW2Wzzp8Y-KKd82nZHQUKA_RGl876RB";
  const money = value => new Intl.NumberFormat("fa-IR").format(Math.round(value)) + " تومان";

  function addQuotePreview() {
    if (document.querySelector(".plus-tier-preview")) return;
    const pricing = document.querySelector(".pricing-highlight");
    if (!pricing) return;
    const card = document.createElement("aside");
    card.className = "plus-tier-preview plus-quote-preview";
    card.setAttribute("role", "note");
    card.innerHTML = '<span class="plus-tier-label">مزیت اعضای فعال پلاس+</span>' +
      '<div class="plus-tier-row" data-discount="10"><span>دو خرید نخست</span><strong>۱۰٪ تخفیف</strong></div>' +
      '<div class="plus-tier-row" data-discount="18"><span>از خرید سوم به بعد</span><strong>۱۸٪ تخفیف</strong></div>' +
      '<small class="plus-quote-copy">این خدمت مشمول بررسی تخفیف پلاس+ است. چون مبلغ نهایی پس از بررسی جزئیات سفارش تعیین می‌شود، مقدار صرفه‌جویی بعد از اعلام قیمت قابل محاسبه خواهد بود. تخفیف با کدها و پیشنهادهای دیگر تجمیع نمی‌شود.</small>' +
      '<a href="/plus.html">جزئیات عضویت پلاس+ ↗</a>';
    pricing.insertAdjacentElement("afterend", card);
  }

  function applyMembership(membership) {
    if (!membership?.is_active) return;
    const discount = Number(membership.discount_percent);
    if (![10, 18].includes(discount)) return;
    window.__alishamsPlusDiscount = discount;
    window.dispatchEvent(new CustomEvent("alishams:plus-discount", { detail: { discount } }));

    document.querySelectorAll(".plus-tier-preview").forEach(card => {
      card.classList.add("is-member-active");
      const label = card.querySelector(".plus-tier-label");
      if (label) label.textContent = "مزیت فعال پلاس+ · تخفیف حساب شما";
      card.querySelectorAll(".plus-tier-row").forEach(row => {
        const active = Number(row.dataset.discount) === discount;
        row.classList.toggle("is-current-tier", active);
        if (active) row.setAttribute("aria-current", "true");
        else row.removeAttribute("aria-current");
      });

      const basePrice = Number(card.dataset.basePrice);
      const resultBox = document.createElement("div");
      resultBox.className = "plus-member-result";
      resultBox.setAttribute("aria-live", "polite");
      if (Number.isFinite(basePrice) && basePrice > 0) {
        const discounted = Math.round(basePrice * (1 - discount / 100));
        resultBox.innerHTML = "<strong>تخفیف فعال شما: " + discount + "٪</strong>" +
          "<span>قیمت برآوردی پس از تخفیف: <b>" + money(discounted) + "</b></span>" +
          "<span>صرفه‌جویی برآوردی: <b>" + money(basePrice - discounted) + "</b></span>" +
          "<small>محاسبه بر اساس قیمت درج‌شده در همین صفحه است؛ مبلغ نهایی پس از بررسی سفارش تأیید می‌شود.</small>";
      } else {
        resultBox.innerHTML = "<strong>تخفیف فعال حساب شما: " + discount + "٪</strong>" +
          "<small>میزان صرفه‌جویی پس از بررسی و اعلام قیمت نهایی سفارش محاسبه می‌شود.</small>";
      }
      const oldResult = card.querySelector(".plus-member-result");
      if (oldResult) oldResult.replaceWith(resultBox);
      else card.appendChild(resultBox);
    });
  }

  async function init() {
    addQuotePreview();
    if (!document.querySelector(".plus-tier-preview")) return;
    try {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError || !sessionData.session?.access_token) return;
      const response = await fetch(SUPABASE_URL + "/functions/v1/plus-membership", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + sessionData.session.access_token,
          "apikey": SUPABASE_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action: "status" })
      });
      if (!response.ok) return;
      const result = await response.json();
      applyMembership(result.membership);
    } catch (error) {
      console.warn("Plus+ price personalization unavailable:", error);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();