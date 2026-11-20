// Daily job (Vercel Cron). Creates due recurring invoices and sends overdue payment reminders.
// Vercel calls this with:  Authorization: Bearer <CRON_SECRET>
const nodemailer = require("nodemailer");
const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_KEY, SECRET = process.env.CRON_SECRET;
const SITE = process.env.SITE_URL || "https://linvoice-hub-web.vercel.app";
const clean = (s, n) => String(s == null ? "" : s).replace(/[\r\n]+/g, " ").replace(/[<>"]/g, "").trim().slice(0, n);
const money = (n) => (+n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function rpc(name, body) {
  const r = await fetch(SB + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(name + " failed (" + r.status + ")");
  return r.json();
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!SB || !KEY || !SECRET) return res.status(500).json({ error: "Missing Vercel settings: SUPABASE_URL, SUPABASE_KEY or CRON_SECRET." });
  if ((req.headers.authorization || "") !== "Bearer " + SECRET) return res.status(401).json({ error: "Unauthorized." });
  const out = { recurring: 0, reminders: 0, errors: [] };
  try {
    const r = await rpc("cron_recurring", { p_secret: SECRET });
    if (r && r.error) out.errors.push("recurring: " + r.error); else out.recurring = (r && r.created) || 0;
  } catch (e) { out.errors.push(e.message); }
  try {
    const list = await rpc("cron_reminders", { p_secret: SECRET });
    if (list && list.error) out.errors.push("reminders: " + list.error);
    else if (Array.isArray(list) && list.length) {
      if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) out.errors.push("Gmail settings are missing in Vercel.");
      else {
        const tr = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
        for (const i of list) {
          try {
            const biz = clean(i.business, 60) || "InvoiceHub", who = clean(i.client_name, 80) || "there", num = clean(i.number, 40);
            const link = SITE + "/view.html?id=" + encodeURIComponent(i.id);
            const text = "Hi " + who + ",\n\nA friendly reminder that invoice " + num + " is overdue. The balance due is Rs. " + money(i.balance) + ".\n\nView and pay online: " + link + "\n\nThank you,\n" + biz;
            await tr.sendMail({ from: '"' + biz + '" <' + process.env.GMAIL_USER + ">", to: i.client_email, subject: "Reminder: invoice " + num + " is overdue", text });
            await rpc("cron_mark", { p_secret: SECRET, p_id: i.id });
            out.reminders++;
          } catch (e) { out.errors.push(clean(i.number, 40) + ": " + (e.message || "could not send")); }
        }
      }
    }
  } catch (e) { out.errors.push(e.message); }
  try { await rpc("cron_touch", { p_secret: SECRET }); } catch (e) { out.errors.push("touch: " + e.message); }
  return res.status(200).json(out);
};
