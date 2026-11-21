// Razorpay webhook. Marks an invoice payment as received when a payment link is paid.
// In Razorpay: Settings > Webhooks > add  https://<your site>/api/rzp-webhook  with the event  payment_link.paid
const crypto = require("crypto");
const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_KEY, SECRET = process.env.CRON_SECRET, WH = process.env.RAZORPAY_WEBHOOK_SECRET;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!WH || !SB || !KEY || !SECRET) return res.status(500).json({ error: "Missing Vercel settings: RAZORPAY_WEBHOOK_SECRET, CRON_SECRET, SUPABASE_URL or SUPABASE_KEY." });
  try {
    const body = await readRaw(req);
    if (body.length > 200000) return res.status(413).json({ error: "Too large." });
    const sig = String(req.headers["x-razorpay-signature"] || "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sig)) return res.status(400).json({ error: "Bad signature." });
    const exp = crypto.createHmac("sha256", WH).update(body).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(sig))) return res.status(400).json({ error: "Bad signature." });
    let ev; try { ev = JSON.parse(body.toString("utf8")); } catch (e) { return res.status(400).json({ error: "Bad body." }); }
    if (!ev || ev.event !== "payment_link.paid") return res.status(200).json({ ignored: true });
    const pay = ev.payload && ev.payload.payment && ev.payload.payment.entity, link = ev.payload && ev.payload.payment_link && ev.payload.payment_link.entity;
    const inv = link && link.notes && link.notes.invoice_id;
    if (!pay || !pay.id || pay.currency !== "INR" || !UUID.test(String(inv || ""))) return res.status(200).json({ ignored: true });
    const amount = Number(pay.amount) / 100;
    if (!(amount > 0)) return res.status(200).json({ ignored: true });
    const r = await fetch(SB + "/rest/v1/rpc/rzp_record_payment", {
      method: "POST", headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ p_secret: SECRET, p_invoice: inv, p_amount: amount, p_ref: "rzp:" + pay.id })
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.error) return res.status(500).json({ error: "Could not record the payment." });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "Something went wrong." });
  }
};
module.exports.config = { api: { bodyParser: false } };
