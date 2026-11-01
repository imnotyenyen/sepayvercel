// api/webhook.js — SePay Webhook + Pusher (Vercel Serverless)
import crypto from 'crypto';

const PUSHER_APP_ID = process.env.PUSHER_APP_ID;
const PUSHER_KEY = process.env.PUSHER_KEY;
const PUSHER_SECRET = process.env.PUSHER_SECRET;
const PUSHER_CLUSTER = process.env.PUSHER_CLUSTER;
const SEPAY_WEBHOOK_SECRET = process.env.SEPAY_WEBHOOK_SECRET;

// ✅ TẮT BODY PARSER CỦA VERCEL ĐỂ ĐỌC RAW BODY
export const config = {
  api: {
    bodyParser: false,
  },
};

// Helper đọc raw body từ stream
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

  // 1. ĐỌC RAW BODY
  const rawBody = await getRawBody(req);

  // 2. LẤY HEADER XÁC THỰC
  const signatureHeader = req.headers['x-sepay-signature']; // dạng "sha256=..."
  const timestampHeader = req.headers['x-sepay-timestamp'];

  if (!signatureHeader || !timestampHeader) {
    return res.status(401).json({ success: false, message: 'Missing signature headers' });
  }

  // 3. KIỂM TRA TIMESTAMP CHỐNG REPLAY (±5 phút)
  const timestamp = parseInt(timestampHeader, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(timestamp) || Math.abs(now - timestamp) > 300) {
    return res.status(401).json({ success: false, message: 'Request expired' });
  }

  // 4. TÍNH CHỮ KÝ MONG ĐỢI TỪ RAW BODY
  // SePay ký: HMAC_SHA256(secret, "{timestamp}.{raw_body}")
  const signPayload = `${timestampHeader}.${rawBody}`;
  const expectedSignature = crypto
    .createHmac('sha256', SEPAY_WEBHOOK_SECRET)
    .update(signPayload)
    .digest('hex');

  // 5. SO SÁNH (constant-time, header có tiền tố "sha256=")
  const receivedSignature = signatureHeader.replace('sha256=', '');
  const sigBuffer = Buffer.from(receivedSignature);
  const expBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }

  // === TỪ ĐÂY XỬ LÝ GIAO DỊCH ===
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ success: false, message: 'Invalid JSON' });
  }

  const content = payload.content || ''; // Nội dung CK, vd: "young974385 chuyen tien"

  // Trích xuất mã đơn hàng
  const orderCodeMatch = content.match(/young\d{6}/);
  if (!orderCodeMatch) {
    // Không phải giao dịch của hệ thống, bỏ qua
    return res.status(200).json({ success: true });
  }
  const orderCode = orderCodeMatch[0];

  // XÁC ĐỊNH GÓI DỰA VÀO SỐ TIỀN
  let icloudEmail, icloudPassword;
  if (payload.transferAmount === 20000) {
    icloudEmail = 'younjmod@gmail.com';
    icloudPassword = 'mkchilafthunghiem';
  } else if (payload.transferAmount === 30000) {
    icloudEmail = 'younjmodid2@icloud.com';
    icloudPassword = 'mkchilatesstkhongphaithat';
  } else {
    // Số tiền không khớp, bỏ qua
    return res.status(200).json({ success: true });
  }

  // GỬI SỰ KIỆN QUA PUSHER
  const channelName = `order-${orderCode}`;

  try {
    const pusherUrl = `https://api-${PUSHER_CLUSTER}.pusher.com/apps/${PUSHER_APP_ID}/events`;
    const pusherBody = {
      name: 'payment_success',
      channels: [channelName],
      data: JSON.stringify({ email: icloudEmail, password: icloudPassword }),
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
      console.error('Pusher API error:', pusherRes.status, errText);
    } else {
      console.log(`✅ Đã gửi iCloud cho đơn ${orderCode}`);
    }
  } catch (error) {
    console.error('Lỗi khi gửi Pusher:', error);
    // Vẫn trả 200 để SePay không retry
  }

  // PHẢN HỒI THÀNH CÔNG CHO SEPAY
  return res.status(200).json({ success: true });
}
