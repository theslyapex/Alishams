(() => {
  const SUPABASE_URL = "https://srfldjfrzmtnlabusssq.supabase.co";
  const SUPABASE_KEY = "sb_publishable_UW2Wzzp8Y-KKd82nZHQUKA_RGl876RB";
  const money = value => new Intl.NumberFormat("fa-IR").format(Math.round(value)) + " تومان";

  async function init() {
    const card = document.querySelector(".plus-tier-preview[data-base-price]");
    if (!card) return;

    const basePrice = Number(card.dataset.basePrice);
    if (!Number.isFinite(basePrice) || basePrice <= 0) return;

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
      const membership = result.membership;
      if (!membership?.is_active) return;

      const discount = Number(membership.discount_percent);
      if (![10, 18].includes(discount)) return;

      const discounted = Math.round(basePrice * (1 - discount / 100));
      const saved = basePrice - discounted;
      card.classList.add("is-member-active");
      card.querySelector(".plus-tier-label").textContent = "تخفیف اختصاصی حساب شما";
      card.querySelectorAll(".plus-tier-row").forEach(row => {
        const isCurrentTier = Number(row.dataset.discount) === discount;
        row.classList.toggle("is-current-tier", isCurrentTier);
        if (isCurrentTier) row.setAttribute("aria-current", "true");
        else row.removeAttribute("aria-current");
      });

      let resultBox = card.querySelector(".plus-member-result");
      if (!resultBox) {
        resultBox = document.createElement("div");
        resultBox.className = "plus-member-result";
        resultBox.setAttribute("aria-live", "polite");
        card.appendChild(resultBox);
      }
      resultBox.innerHTML = "<strong>تخفیف فعال شما: " + discount + "٪</strong>" +
        "<span>قیمت پس از تخفیف: <b>" + money(discounted) + "</b></span>" +
        "<span>صرفه‌جویی شما: <b>" + money(saved) + "</b></span>" +
        "<small>این مبلغ بر اساس قیمت درج‌شده در همین صفحه محاسبه شده است؛ مبلغ نهایی سفارش پس از بررسی جزئیات تأیید می‌شود.</small>";
    } catch (error) {
      console.warn("Plus+ price personalization unavailable:", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();