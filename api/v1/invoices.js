
// Public API. GET /api/v1/invoices lists invoices. POST /api/v1/invoices creates a draft invoice.
// Authenticate with:  Authorization: Bearer <your API key>
const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_KEY;
const TEMPLATES = ["classic", "bold", "soft", "elegant", "fresh"];
const EXTRA = ["baddr", "bmail", "bphone", "gstin", "caddr", "cgstin", "pos", "bstate", "bank", "terms", "doc"];
const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : undefined);

async function rpc(key, op, p) {
  const r = await fetch(SB + "/rest/v1/rpc/api_invoices", {
    method: "POST",
    headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ p_key: key, p_op: op, p: p || {} })
  });
  let body = null;
  try { body = await r.json(); } catch (e) {}
  return { ok: r.ok, body };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!SB || !KEY) return res.status(500).json({ error: "Server is not configured." });
  const key = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!/^ih_[0-9a-f]{48}$/.test(key)) return res.status(401).json({ error: "Missing or invalid API key." });
  try {
    if (req.method === "GET") {
      const r = await rpc(key, "list");
      if (r.body && r.body.error === "invalid_api_key") return res.status(401).json({ error: "Invalid API key." });
      if (!r.ok) return res.status(502).json({ error: "Could not load invoices." });
      return res.status(200).json({ invoices: r.body });
    }
    if (req.method === "POST") {
      const b = req.body && typeof req.body === "object" ? req.body : null;
      if (!b) return res.status(400).json({ error: "Send a JSON body." });
      const client = str(b.client_name, 200);
      if (!client) return res.status(400).json({ error: "client_name is required." });
      if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 100) return res.status(400).json({ error: "items must be a list of 1 to 100 entries." });
      const items = [];
      for (const it of b.items) {
        const q = Number(it && it.q), p = Number(it && it.p);
        if (!it || !isFinite(q) || !isFinite(p) || q < 0 || p < 0) return res.status(400).json({ error: "Each item needs d (text), q (quantity) and p (price) as numbers." });
        items.push({ d: str(it.d, 300) || "Item", q, p, h: str(it.h, 20) || "" });
      }
      const gst = b.gst == null ? 18 : Number(b.gst);
      if (!isFinite(gst) || gst < 0 || gst > 28) return res.status(400).json({ error: "gst must be between 0 and 28." });
      const due = b.due_days == null ? 15 : Math.round(Number(b.due_days));
      if (!isFinite(due) || due < 0 || due > 365) return res.status(400).json({ error: "due_days must be between 0 and 365." });
      const extra = {};
      for (const k of EXTRA) { const v = b.extra && str(b.extra[k], 300); if (v) extra[k] = v; }
      const payload = {
        number: str(b.number, 40), business: str(b.business, 200), client_name: client, client_email: str(b.client_email, 200),
        template: TEMPLATES.includes(b.template) ? b.template : "classic", gst, due_days: due, items, upi: str(b.upi, 100), extra
      };
      const r = await rpc(key, "create", payload);
      if (r.body && r.body.error === "invalid_api_key") return res.status(401).json({ error: "Invalid API key." });
      if (!r.ok || !r.body || !r.body.id) return res.status(502).json({ error: "Could not create the invoice." });
      return res.status(201).json({ id: r.body.id, link: "https://" + req.headers.host + "/view.html?id=" + r.body.id });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Use GET or POST." });
  } catch (e) {
    return res.status(500).json({ error: "Something went wrong." });
  }
};
