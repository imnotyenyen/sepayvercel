import Pusher from "pusher";

// Khởi tạo Pusher với thông tin từ dashboard Pusher của bạn
const pusher = new Pusher({
  appId: "2208543",
  key: "a0a4b6ef806dcf80d133",
  secret: "5f33e372eacee460c8a6",
  cluster: "ap1",
  useTLS: true
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const data = req.body;
    
    // SePay webhook data structure cơ bản
    // data.content: Nội dung chuyển khoản (Ví dụ: "young974385")
    // data.transferAmount: Số tiền chuyển
    const content = data.content || "";
    const amount = Number(data.transferAmount || data.amount || 0);

    // Lọc nội dung chứa cú pháp "young" + 6 chữ số ngẫu nhiên
    const match = content.match(/young([0-9]{6})/i);
    if (!match) {
      return res.status(200).json({ success: true, message: "Ignored: Invalid syntax" });
    }

    const transferCode = match[0].toLowerCase(); // ví dụ: young974385

    // Xác định gói và tài khoản mật khẩu tương ứng dựa vào số tiền
    let accountInfo = null;

    if (amount >= 20000 && amount < 30000) {
      // Gói 20k
      accountInfo = {
        package: "Gói 20k (Minecraft)",
        email: "younjmod@gmail.com",
        pass: "mkchilafthunghiem"
      };
    } else if (amount >= 30000) {
      // Gói 30k (Combo)
      accountInfo = {
        package: "Gói 30k (Combo)",
        email: "younjmodid2@icloud.com",
        pass: "mkchilatesstkhongphaithat"
      };
    }

    if (accountInfo) {
      // Bắn sự kiện qua Pusher đến channel có tên là mã giao dịch
      await pusher.trigger(`payment-channel-${transferCode}`, "payment-success", {
        success: true,
        amount: amount,
        content: content,
        ...accountInfo
      });
    }

    return res.status(200).json({ success: true, message: "Webhook processed successfully" });
  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
