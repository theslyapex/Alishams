const SKIP = new Set([
  "/", "/index.html", "/admin.html", "/admin-panel.html", "/admin-projects.html",
  "/admin-inbox.html", "/orders-admin.html", "/videos-admin.html",
  "/portfolio-admin.html", "/studio-control-7f3c9a.html"
]);
export async function onRequest(context) {
  const response = await context.next();
  const url = new URL(context.request.url);
  const type = response.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("text/html") || SKIP.has(url.pathname)) return response;
  return new HTMLRewriter()
    .on("head", {
      element(element) {
        element.append('<link rel="stylesheet" href="/site-header.css?v=1">', { html: true });
        element.append('<script src="/site-header.js?v=1" defer></script>', { html: true });
      }
    })
    .transform(response);
}