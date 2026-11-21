// GET  /api/pay  -> { configured: true|false }
// POST /api/pay  -> creates a Razorpay payment link for an invoice's balance. Body: { invoice_id }
// Needs a signed-in user (Authorization: Bearer <session token>).
const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_KEY;
const RK = process.env.RAZORPAY_KEY_ID, RS = process.env.RAZORPAY_KEY_SECRET;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (s, n) => String(s == null ? "" : s).replace(/[\r\n]+/g, " ").trim().slice(0, n);

function balanceOf(inv) {
  let sub = 0;
  (Array.isArray(inv.items) ? inv.items : []).forEach((x) => { sub += (Number(x.q) || 0) * (Number(x.p) || 0); });
  const total = sub * (1 + (Number(inv.gst) || 0) / 100);
  let paid = 0;
  const pays = inv.extra && Array.isArray(inv.extra.payments) ? inv.extra.payments : [];
  pays.forEach((p) => { paid += Number(p.a) || 0; });
  if (inv.status === "paid") return 0;
  return Math.max(0, total - paid);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") return res.status(200).json({ configured: !!(RK && RS) });
  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ error: "Use GET or POST." }); }
  if (!SB || !KEY) return res.status(500).json({ error: "Server is not configured." });
  if (!RK || !RS) return res.status(503).json({ error: "Online payments are not set up yet. Add the Razorpay keys in Vercel." });
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return res.status(401).json({ error: "Please sign in again." });
    const u = await fetch(SB + "/auth/v1/user", { headers: { apikey: KEY, Authorization: "Bearer " + token } });
    if (!u.ok) return res.status(401).json({ error: "Please sign in again." });
    const id = req.body && req.body.invoice_id;
    if (!UUID.test(String(id || ""))) return res.status(400).json({ error: "invoice_id is required." });
    const h = { apikey: KEY, Authorization: "Bearer " + token, Accept: "application/json" };
    const r = await fetch(SB + "/rest/v1/invoices?id=eq." + id + "&select=id,number,business,client_name,client_email,gst,items,status,extra", { headers: h });
    const rows = r.ok ? await r.json() : [];
    const inv = rows && rows[0];
    if (!inv) return res.status(404).json({ error: "Invoice not found." });
    if (inv.extra && inv.extra.doc === "quote") return res.status(400).json({ error: "A quote cannot be paid. Convert it to an invoice first." });
    const bal = balanceOf(inv);
    if (bal < 1) return res.status(400).json({ error: "Nothing is due on this invoice." });
    const body = {
      amount: Math.round(bal * 100), currency: "INR", accept_partial: false,
      reference_id: id.slice(0, 8) + "-" + Date.now().toString(36),
      description: clean("Invoice " + inv.number + (inv.business ? " from " + inv.business : ""), 200),
      notify: { sms: false, email: false }, reminder_enable: false,
      notes: { invoice_id: id, number: clean(inv.number, 40) }
    };
    const email = clean(inv.client_email, 200);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) body.customer = { name: clean(inv.client_name, 100) || "Customer", email };
    const rr = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST", headers: { Authorization: "Basic " + Buffer.from(RK + ":" + RS).toString("base64"), "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    const rj = await rr.json().catch(() => ({}));
    if (!rr.ok || !rj.short_url) return res.status(502).json({ error: "Razorpay said: " + ((rj.error && rj.error.description) || "could not create the link.") });
    const extra = Object.assign({}, inv.extra || {}, { paylink: { id: rj.id, url: rj.short_url, amount: Math.round(bal * 100) / 100, created: new Date().toISOString() } });
    const pr = await fetch(SB + "/rest/v1/invoices?id=eq." + id, { method: "PATCH", headers: Object.assign({ "Content-Type": "application/json", Prefer: "return=minimal" }, h), body: JSON.stringify({ extra }) });
    return res.status(200).json({ url: rj.short_url, id: rj.id, saved: pr.ok });
  } catch (e) {
    return res.status(500).json({ error: "Something went wrong." });
  }
};
