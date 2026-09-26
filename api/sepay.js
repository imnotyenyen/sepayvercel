/**
 * Vercel serverless — nhận webhook SePay, forward sang Cloudflare Worker
 * Env vars (set trên Vercel dashboard):
 *   SEPAY_API_KEY   — SePay dashboard cấp
 *   WORKER_URL      — https://younj-payment.YOUR-SUB.workers.dev
 *   WEBHOOK_SECRET  — khớp với Worker
 */

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // 1. Xác thực SePay
  const auth = req.headers.authorization || "";
  if (auth !== `Apikey ${process.env.SEPAY_API_KEY}`) {
    console.warn("❌ SePay auth failed");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const payload = req.body || {};
  console.log("📥 SePay webhook:", {
    id: payload.id,
    type: payload.transferType,
    amount: payload.transferAmount,
    content: payload.content,
  });

  // 2. Chỉ xử lý tiền vào
  if (payload.transferType !== "in") {
    return res.json({ ok: true, skipped: "not-in" });
  }

  // 3. Forward sang Worker
  try {
    const r = await fetch(process.env.WORKER_URL + "/pay", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": process.env.WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        content:         payload.content,
        transferAmount:  payload.transferAmount,
        referenceCode:   payload.referenceCode,
        gateway:         payload.gateway,
        transactionDate: payload.transactionDate,
      }),
    });

    const data = await r.json();
    console.log("✅ Worker responded:", data);
    return res.json({ ok: true, worker: data });
  } catch (err) {
    console.error("❌ Forward to Worker failed:", err);
    return res.status(502).json({ error: "Worker unreachable", detail: err.message });
  }
}
