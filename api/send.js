// Vercel serverless function: emails an invoice PDF through a Gmail account.
const nodemailer = require("nodemailer");

const DAILY_LIMIT = 20; // emails per signed-in user per 24 hours
const clean = (s, n) => String(s == null ? "" : s).replace(/[\r\n]+/g, " ").replace(/[<>"]/g, "").trim().slice(0, n);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  try {
    const need = ["SUPABASE_URL", "SUPABASE_KEY", "GMAIL_USER", "GMAIL_APP_PASSWORD"];
    for (const k of need) {
      if (!process.env[k]) return res.status(500).json({ error: "Server setting missing: " + k });
    }
    const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_KEY;

    // 1. Only signed-in users may send.
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Please sign in again." });
    const u = await fetch(SB + "/auth/v1/user", { headers: { apikey: KEY, Authorization: "Bearer " + token } });
    if (!u.ok) return res.status(401).json({ error: "Please sign in again." });
    const user = await u.json();

    // 2. Check the input.
    const b = req.body || {};
    const to = String(b.to || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 200) return res.status(400).json({ error: "Enter a valid client email." });
    if (typeof b.pdf !== "string" || b.pdf.length < 100 || b.pdf.length > 3600000) return res.status(400).json({ error: "The PDF is missing or too large." });
    const subject = clean(b.subject, 150) || "Your invoice";
    const message = String(b.message || "").slice(0, 5000);
    const fromName = clean(b.fromName, 60) || "InvoiceHub";
    const filename = clean(b.filename, 60).replace(/[^\w.\- ]/g, "") || "invoice.pdf";

    // 3. Daily limit per user (stored in the email_log table).
    const hdr = { apikey: KEY, Authorization: "Bearer " + token };
    const since = new Date(Date.now() - 864e5).toISOString();
    const c = await fetch(SB + "/rest/v1/email_log?select=id&created_at=gte." + encodeURIComponent(since), { headers: hdr });
    if (!c.ok) return res.status(500).json({ error: "Could not check the daily limit. Run the email_log SQL in Supabase first." });
    const rows = await c.json();
    if (rows.length >= DAILY_LIMIT) return res.status(429).json({ error: "Daily email limit reached (" + DAILY_LIMIT + "). Try again tomorrow." });

    // 4. Send.
    const tr = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    });
    await tr.sendMail({
      from: '"' + fromName + '" <' + process.env.GMAIL_USER + ">",
      replyTo: user.email,
      to: to,
      subject: subject,
      text: message,
      html: "<div style=\"font-family:Arial,sans-serif;font-size:15px;line-height:1.6\">" + esc(message).replace(/\n/g, "<br>") + "</div>",
      attachments: [{ filename: filename, content: b.pdf, encoding: "base64", contentType: "application/pdf" }]
    });

    // 5. Record it for the daily limit.
    await fetch(SB + "/rest/v1/email_log", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, hdr), body: "{}" });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "Could not send: " + (e && e.message ? e.message : "unknown error") });
  }
};
