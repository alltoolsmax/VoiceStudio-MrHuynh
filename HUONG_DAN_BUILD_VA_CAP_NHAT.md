# Build và phát hành bản cập nhật Voice Studio - Mr.Huỳnh

Mọi thứ chạy trên máy Windows của bạn và hosting active.mrhuynh.net, không cần GitHub.

## A. Chuẩn bị máy build (làm một lần, khoảng 30 phút)

Mở **PowerShell** và chạy lần lượt (mỗi lệnh xong mới chạy lệnh sau):

```powershell
winget install OpenJS.NodeJS.LTS
winget install Rustlang.Rustup
winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
powershell -c "irm bun.sh/install.ps1 | iex"
powershell -c "irm https://astral.sh/uv/0.12.13/install.ps1 | iex"
```

**Đóng PowerShell, mở lại**, rồi chạy:

```powershell
rustup target add x86_64-pc-windows-msvc
```

Cần khoảng 25 GB trống trên ổ đĩa. Giải nén mã nguồn (`voice-studio-source.zip`) vào một thư mục
có đường dẫn ngắn, không dấu, ví dụ `D:\VoiceStudio`.

## B. Build một bản mới

1. Sửa mã nguồn (hoặc nhờ người sửa) như bình thường.
2. Mở PowerShell tại `D:\VoiceStudio` rồi chạy, thay số phiên bản và ghi chú:

   ```powershell
   .\BUILD-WINDOWS.bat -Version 1.0.1 -Notes "Sửa lỗi lồng tiếng; Gói mua dễ nhìn hơn"
   ```

   - `-Version`: luôn **lớn hơn** bản trước (1.0.0 → 1.0.1 → 1.0.2 …). Script tự đổi số phiên
     bản ở mọi chỗ cần thiết.
   - `-Notes`: phần "Có gì mới", các ý cách nhau bằng dấu `;`. Hiện trong app khi khách cập nhật
     và trên trang tải.
   - Script tự kiểm tra công cụ; thiếu gì sẽ in ra lệnh cài.
   - Lần đầu mất 15–30 phút, các lần sau nhanh hơn.

3. Xong, thư mục `upload\` tự mở, gồm 4 file.

## C. Upload lên hosting

cPanel → **File Manager** → `active.mrhuynh.net/downloads/` → **Upload**, theo thứ tự:

1. `VoiceStudio-MrHuynh-1.0.1-win-x64.exe`
2. `VoiceStudio-MrHuynh-1.0.1-win-x64.exe.blockmap`
3. `voice-studio-source.zip` (ghi đè file cũ)
4. `electron-stable-win32-x64.yml` (ghi đè file cũ) — **luôn để cuối cùng**: app khách đọc file
   này để biết có bản mới, nên file .exe phải lên đủ trước.

Không xóa `downloads/index.php`. Các file .exe cũ có thể xóa sau vài ngày.

Kiểm tra: mở **https://active.mrhuynh.net/downloads/** phải thấy nút "Tải bản 1.0.1".

## D. Khách nhận bản mới thế nào

- App khách kiểm tra bản mới khi mở và định kỳ; thấy bản mới thì **tự tải ngầm**, xong hiện
  **"Khởi động lại để cài"**. Bản quyền, giọng và dự án được giữ nguyên.
- Khách cũng có thể vào **Cài đặt → Cập nhật** để kiểm tra ngay.
- **Bắt buộc cập nhật** (khi bản cũ có lỗi nghiêm trọng): trang quản trị → **Phát hành & cập
  nhật** → nhập `1.0.1` → Lưu. Khách dùng bản thấp hơn sẽ bị chặn bằng màn hình "Cần cập nhật để
  tiếp tục" (có nút tải và nút mở trang tải). Để trống ô này để tắt.

## E. Lưu ý quan trọng

- **Khách đang dùng bản trước 1.0.0** (các bản build từ GitHub) **không tự cập nhật được** sang
  hosting mới: hãy gửi họ link **https://active.mrhuynh.net/downloads/** để cài bản 1.0.0 đè lên
  một lần. Bản quyền và dữ liệu vẫn giữ nguyên. Từ 1.0.0 trở đi sẽ tự cập nhật.
- Windows SmartScreen có thể cảnh báo vì bộ cài chưa ký số: khách bấm **More info → Run anyway**.
  Muốn hết cảnh báo cần mua chứng thư ký mã (code signing certificate).
- Không bao giờ đưa `config.php`, file khóa bí mật của KeyGen hay `data.sqlite` vào thư mục
  mã nguồn gửi người khác; script nén mã nguồn đã tự loại các file này.
- Giấy phép AGPL-3.0: file `voice-studio-source.zip` trên trang tải là mã nguồn bạn cung cấp
  cho người dùng (nút "Mã nguồn" trong app trỏ tới file này). Mỗi lần phát hành hãy upload lại.
