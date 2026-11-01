// api/webhook.js — SePay Webhook + Pusher (Vercel Serverless)
// Giá trị đang để thẳng trong code để test. Khi chạy ổn, thêm biến môi trường
// trên Vercel cùng tên thì code tự dùng biến đó (ưu tiên hơn giá trị mặc định).
import crypto from 'crypto';

const PUSHER_APP_ID  = process.env.PUSHER_APP_ID  || '2208543';
const PUSHER_KEY     = process.env.PUSHER_KEY     || 'a0a4b6ef806dcf80d133';
const PUSHER_SECRET  = process.env.PUSHER_SECRET  || '5f33e372eacee460c8a6';
const PUSHER_CLUSTER = process.env.PUSHER_CLUSTER || 'ap1';

// SePay: giữ nguyên biến đang có trên Vercel (xác thực đã chạy đúng)
const SEPAY_API_KEY        = process.env.SEPAY_API_KEY;
const SEPAY_WEBHOOK_SECRET = process.env.SEPAY_WEBHOOK_SECRET;

const ACCOUNTS = {
  20000: {
    email:    process.env.ICLOUD_20K_EMAIL    || 'younjmod@gmail.com',
    password: process.env.ICLOUD_20K_PASSWORD || 'mkchilafthunghiem',
  },
  30000: {
    email:    process.env.ICLOUD_30K_EMAIL    || 'younjmodid2@icloud.com',
    password: process.env.ICLOUD_30K_PASSWORD || 'mkchilatesstkhongphaithat',
  },
};

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function isAuthorized(req, rawBody) {
  if (SEPAY_API_KEY) {
    const auth = req.headers['authorization'] || '';
    if (safeEqual(auth, `Apikey ${SEPAY_API_KEY}`)) return true;
  }
  const sig = req.headers['x-sepay-signature'];
  const ts = req.headers['x-sepay-timestamp'];
  if (SEPAY_WEBHOOK_SECRET && sig && ts) {
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(ts, 10)) > 300) return false;
    const expected = crypto
      .createHmac('sha256', SEPAY_WEBHOOK_SECRET)
      .update(`${ts}.${rawBody}`)
      .digest('hex');
    return safeEqual(String(sig).replace('sha256=', ''), expected);
  }
  return false;
}

// Gọi Pusher REST API: xác thực qua query string
async function pusherTrigger(channel, eventName, dataObj) {
  const body = JSON.stringify({
    name: eventName,
    channel,
    data: JSON.stringify(dataObj),
  });

  const path = `/apps/${PUSHER_APP_ID}/events`;
  const params = {
    auth_key: PUSHER_KEY,
    auth_timestamp: String(Math.floor(Date.now() / 1000)),
    auth_version: '1.0',
    body_md5: crypto.createHash('md5').update(body).digest('hex'),
  };

  const query = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');

  const signature = crypto
    .createHmac('sha256', PUSHER_SECRET)
    .update(`POST\n${path}\n${query}`)
    .digest('hex');

  const url = `https://api-${PUSHER_CLUSTER}.pusher.com${path}?${query}&auth_signature=${signature}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) throw new Error(`Pusher ${res.status}: ${await res.text()}`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawBody = await getRawBody(req);

  if (!isAuthorized(req, rawBody)) {
    console.log('❌ Xác thực thất bại (có thể là request từ Pusher Webhooks, bỏ qua được)');
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ success: false, message: 'Invalid JSON' });
  }

  console.log('=== DỮ LIỆU TỪ SEPAY ===', JSON.stringify(payload));

  if (payload.transferType && payload.transferType !== 'in') {
    return res.status(200).json({ success: true });
  }

  const haystack = `${payload.content || ''} ${payload.code || ''} ${payload.description || ''}`;
  const match = haystack.match(/young\s?(\d{6})/i);
  if (!match) {
    console.log('❌ Không tìm thấy mã đơn trong nội dung CK:', haystack);
    return res.status(200).json({ success: true });
  }
  const orderCode = `young${match[1]}`;

  const amount = Number(payload.transferAmount);
  const account = ACCOUNTS[amount];
  if (!account) {
    console.log('❌ Số tiền không khớp gói nào:', amount);
    return res.status(200).json({ success: true });
  }

  console.log(`✅ Gói ${amount}, đơn ${orderCode}. Gửi Pusher tới kênh cache-order-${orderCode}`);

  try {
    await pusherTrigger(`cache-order-${orderCode}`, 'payment_success', {
      email: account.email,
      password: account.password,
    });
    console.log(`🎉 Đã gửi tài khoản cho đơn ${orderCode}`);
  } catch (err) {
    console.error('❌ Lỗi Pusher:', err.message);
    return res.status(500).json({ success: false });
  }

  return res.status(200).json({ success: true });
}
