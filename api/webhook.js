// api/webhook.js — SePay Webhook + Pusher (Vercel Serverless) — bản đã sửa
import crypto from 'crypto';

const {
  PUSHER_APP_ID,
  PUSHER_KEY,
  PUSHER_SECRET,
  PUSHER_CLUSTER,
  SEPAY_API_KEY,         // kiểu "Apikey" (Authorization header) — cách SePay dùng phổ biến
  SEPAY_WEBHOOK_SECRET,  // kiểu HMAC (nếu tài khoản SePay của bạn có gửi signature)
} = process.env;

// Tài khoản theo gói — đưa vào Environment Variables trên Vercel, đừng hardcode
const ACCOUNTS = {
  20000: { email: process.env.ICLOUD_20K_EMAIL, password: process.env.ICLOUD_20K_PASSWORD },
  30000: { email: process.env.ICLOUD_30K_EMAIL, password: process.env.ICLOUD_30K_PASSWORD },
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
  // Cách 1: Authorization: Apikey xxx
  if (SEPAY_API_KEY) {
    const auth = req.headers['authorization'] || '';
    if (safeEqual(auth, `Apikey ${SEPAY_API_KEY}`)) return true;
  }
  // Cách 2: HMAC signature
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

// ✅ Gọi Pusher REST API ĐÚNG CHUẨN: xác thực qua query string, KHÔNG phải header
async function pusherTrigger(channel, eventName, dataObj) {
  const body = JSON.stringify({
    name: eventName,
    channel,                       // 1 kênh
    data: JSON.stringify(dataObj), // data phải là chuỗi
  });

  const path = `/apps/${PUSHER_APP_ID}/events`;
  const params = {
    auth_key: PUSHER_KEY,
    auth_timestamp: String(Math.floor(Date.now() / 1000)),
    auth_version: '1.0',
    body_md5: crypto.createHash('md5').update(body).digest('hex'),
  };

  // Các tham số phải sắp xếp theo thứ tự chữ cái
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
    console.log('❌ Xác thực SePay thất bại. Headers nhận được:', Object.keys(req.headers).join(', '));
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ success: false, message: 'Invalid JSON' });
  }

  console.log('=== DỮ LIỆU TỪ SEPAY ===', JSON.stringify(payload));

  // Chỉ xử lý tiền VÀO
  if (payload.transferType && payload.transferType !== 'in') {
    return res.status(200).json({ success: true });
  }

  // ✅ Không phân biệt hoa/thường (ngân hàng hay đổi thành YOUNG123456) + thử cả trường code
  const haystack = `${payload.content || ''} ${payload.code || ''} ${payload.description || ''}`;
  const match = haystack.match(/young\s?(\d{6})/i);
  if (!match) {
    console.log('❌ Không tìm thấy mã đơn trong nội dung CK:', haystack);
    return res.status(200).json({ success: true });
  }
  const orderCode = `young${match[1]}`; // luôn chữ thường để khớp tên kênh ở frontend

  const amount = Number(payload.transferAmount);
  const account = ACCOUNTS[amount];
  if (!account || !account.email) {
    console.log('❌ Số tiền không khớp gói nào:', amount);
    return res.status(200).json({ success: true });
  }

  try {
    await pusherTrigger(`order-${orderCode}`, 'payment_success', {
      email: account.email,
      password: account.password,
    });
    console.log(`🎉 Đã gửi tài khoản cho đơn ${orderCode}`);
  } catch (err) {
    console.error('❌ Lỗi Pusher:', err.message);
    return res.status(500).json({ success: false }); // để SePay retry
  }

  return res.status(200).json({ success: true });
}
