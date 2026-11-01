// Sử dụng thư viện crypto có sẵn của Node.js
import crypto from 'crypto';

// Cấu hình thông tin Pusher và SePay
const PUSHER_APP_ID = process.env.PUSHER_APP_ID;
const PUSHER_KEY = process.env.PUSHER_KEY;
const PUSHER_SECRET = process.env.PUSHER_SECRET;
const PUSHER_CLUSTER = process.env.PUSHER_CLUSTER;
const SEPAY_WEBHOOK_SECRET = process.env.SEPAY_WEBHOOK_SECRET; // Sẽ lấy ở bước 4

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. XÁC THỰC CHỮ KÝ (RẤT QUAN TRỌNG)
  const signature = req.headers['x-sepay-signature'];
  const timestamp = req.headers['x-sepay-timestamp'];
  
  if (!signature || !timestamp) {
    return res.status(401).json({ error: 'Missing signature' });
  }

  // Tạo chữ ký từ raw body
  const rawBody = JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', SEPAY_WEBHOOK_SECRET)
    .update(timestamp + '.' + rawBody)
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // 2. XỬ LÝ GIAO DỊCH
  const payload = req.body;
  const content = payload.content; // Nội dung chuyển khoản, ví dụ: "young974385 chuyen tien"
  
  // Trích xuất mã đơn hàng từ nội dung
  const orderCodeMatch = content.match(/young\d{6}/);
  if (!orderCodeMatch) {
    // Không phải giao dịch của hệ thống, bỏ qua
    return res.status(200).json({ success: true });
  }
  const orderCode = orderCodeMatch[0];

  // 3. XÁC ĐỊNH GÓI VÀ LẤY THÔNG TIN iCLOUD TƯƠNG ỨNG
  // Vì không có database, ta dựa vào số tiền để phân biệt gói
  let icloudEmail, icloudPassword;
  if (payload.transferAmount === 20000) {
    icloudEmail = 'younjmod@gmail.com';
    icloudPassword = 'mkchilafthunghiem';
  } else if (payload.transferAmount === 30000) {
    icloudEmail = 'younjmodid2@icloud.com';
    icloudPassword = 'mkchilatesstkhongphaithat';
  } else {
    // Số tiền không khớp, có thể là giao dịch khác
    return res.status(200).json({ success: true });
  }

  // 4. GỬI SỰ KIỆN QUA PUSHER ĐẾN KÊNH CỦA ĐƠN HÀNG
  // Kênh Pusher sẽ có tên trùng với mã đơn hàng
  const channelName = `order-${orderCode}`;
  
  try {
    // Gọi API của Pusher để trigger event
    const pusherUrl = `https://api-${PUSHER_CLUSTER}.pusher.com/apps/${PUSHER_APP_ID}/events`;
    const pusherBody = {
      name: 'payment_success',
      channels: [channelName],
      data: JSON.stringify({
        email: icloudEmail,
        password: icloudPassword
      })
    };

    // Tạo chữ ký xác thực cho Pusher
    const authKey = PUSHER_KEY;
    const authTimestamp = Math.floor(Date.now() / 1000);
    const authString = `POST\n/apps/${PUSHER_APP_ID}/events\n${JSON.stringify(pusherBody)}`;
    const authSignature = crypto
      .createHmac('sha256', PUSHER_SECRET)
      .update(authTimestamp + '\n' + authString)
      .digest('hex');

    await fetch(pusherUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Pusher-Key': authKey,
        'X-Pusher-Timestamp': authTimestamp.toString(),
        'X-Pusher-Signature': authSignature
      },
      body: JSON.stringify(pusherBody)
    });

    console.log(`Đã gửi thông tin iCloud cho đơn hàng ${orderCode}`);

  } catch (error) {
    console.error('Lỗi khi gửi Pusher:', error);
    // Vẫn trả về 200 để SePay không gửi lại
  }

  // 5. PHẢN HỒI THÀNH CÔNG CHO SEPAY
  // Bắt buộc phải trả về 200 và body {"success": true} trong vòng 30 giây
  return res.status(200).json({ success: true });
}
