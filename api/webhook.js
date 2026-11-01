// api/webhook.js — SePay Webhook + Pusher (Vercel Serverless)
import crypto from 'crypto';

const PUSHER_APP_ID = process.env.PUSHER_APP_ID;
const PUSHER_KEY = process.env.PUSHER_KEY;
const PUSHER_SECRET = process.env.PUSHER_SECRET;
const PUSHER_CLUSTER = process.env.PUSHER_CLUSTER;
const SEPAY_WEBHOOK_SECRET = process.env.SEPAY_WEBHOOK_SECRET;

export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const signatureHeader = req.headers['x-sepay-signature'];
  const timestampHeader = req.headers['x-sepay-timestamp'];

  if (!signatureHeader || !timestampHeader) {
    return res.status(401).json({ success: false, message: 'Missing signature headers' });
  }

  const timestamp = parseInt(timestampHeader, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(timestamp) || Math.abs(now - timestamp) > 300) {
    return res.status(401).json({ success: false, message: 'Request expired' });
  }

  const signPayload = `${timestampHeader}.${rawBody}`;
  const expectedSignature = crypto
    .createHmac('sha256', SEPAY_WEBHOOK_SECRET)
    .update(signPayload)
    .digest('hex');

  const receivedSignature = signatureHeader.replace('sha256=', '');
  const sigBuffer = Buffer.from(receivedSignature);
  const expBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ success: false, message: 'Invalid JSON' });
  }

  // 🔍 LOG DEBUG: In ra toàn bộ dữ liệu SePay gửi sang
  console.log("=== DỮ LIỆU TỪ SEPAY ===");
  console.log("Nội dung CK (content):", payload.content);
  console.log("Số tiền (transferAmount):", payload.transferAmount);

  const content = payload.content || '';
  const orderCodeMatch = content.match(/young\d{6}/);
  
  if (!orderCodeMatch) {
    console.log("❌ LỖI: Không tìm thấy mã đơn (young + 6 số) trong nội dung chuyển khoản.");
    return res.status(200).json({ success: true });
  }
  const orderCode = orderCodeMatch[0];

  let icloudEmail, icloudPassword;
  if (payload.transferAmount === 20000) {
    icloudEmail = 'younjmod@gmail.com';
    icloudPassword = 'mkchilafthunghiem';
    console.log("✅ Nhận diện gói 20K");
  } else if (payload.transferAmount === 30000) {
    icloudEmail = 'younjmodid2@icloud.com';
    icloudPassword = 'mkchilatesstkhongphaithat';
    console.log("✅ Nhận diện gói 30K");
  } else {
    console.log("❌ LỖI: Số tiền không khớp 20.000 hoặc 30.000. Số tiền thực tế nhận được:", payload.transferAmount);
    return res.status(200).json({ success: true });
  }

  const channelName = `order-${orderCode}`;
  console.log(`🚀 Chuẩn bị gửi Pusher tới kênh: ${channelName}`);

  try {
    const pusherUrl = `https://api-${PUSHER_CLUSTER}.pusher.com/apps/${PUSHER_APP_ID}/events`;
    
    const pusherBody = {
      name: 'payment_success',
      channels: [String(channelName)],
      data: JSON.stringify({ email: String(icloudEmail), password: String(icloudPassword) }),
    };

    const authTimestamp = Math.floor(Date.now() / 1000);
    const authString = `POST\n/apps/${PUSHER_APP_ID}/events\n${JSON.stringify(pusherBody)}`;
    const authSignature = crypto
      .createHmac('sha256', PUSHER_SECRET)
      .update(authTimestamp + '\n' + authString)
      .digest('hex');

    const pusherRes = await fetch(pusherUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Pusher-Key': PUSHER_KEY,
        'X-Pusher-Timestamp': authTimestamp.toString(),
        'X-Pusher-Signature': authSignature,
      },
      body: JSON.stringify(pusherBody),
    });

    if (!pusherRes.ok) {
      const errText = await pusherRes.text();
      console.error(`❌ Lỗi Pusher API (${pusherRes.status}):`, errText);
    } else {
      console.log(`🎉 THÀNH CÔNG: Đã gửi iCloud qua Pusher cho đơn ${orderCode}`);
    }
  } catch (error) {
    console.error('❌ Lỗi khi fetch Pusher:', error);
  }

  return res.status(200).json({ success: true });
}
