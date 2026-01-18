# 📊 Google Sheets Auto-Export Setup (Apps Script)

ระบบจะ export ข้อมูล jobs อัตโนมัติไปยัง Google Sheets ทุกครั้งที่ job เสร็จสิ้น

---

## 🎯 ขั้นตอนการตั้งค่า

### **1. สร้าง Google Spreadsheet**

1. ไปที่ https://sheets.google.com
2. คลิก **+ Blank** เพื่อสร้าง Spreadsheet ใหม่
3. ตั้งชื่อว่า "HotelPlus Jobs Export" (หรือชื่ออื่นตามต้องการ)

### **2. เพิ่ม Apps Script**

1. คลิก **Extensions** → **Apps Script**
2. ลบ code เดิมทิ้ง
3. Copy code จากไฟล์ `scripts/google-apps-script.js` ไปวาง
4. คลิก **💾 Save** (Ctrl+S)
5. ตั้งชื่อ Project: "HotelPlus Export"

### **3. Deploy Web App**

1. คลิก **Deploy** → **New deployment**
2. คลิก ⚙️ → เลือก **Web app**
3. ตั้งค่า:
   - **Execute as**: Me (your-email@gmail.com)
   - **Who has access**: **Anyone**
4. คลิก **Deploy**
5. **Copy Web app URL** (จะได้ URL แบบนี้):
   ```
   https://script.google.com/macros/s/AKfycbx.../exec
   ```

### **4. เพิ่ม Environment Variable ใน Vercel**

1. ไปที่ Vercel Dashboard → Project → **Settings** → **Environment Variables**
2. เพิ่ม:
   ```
   GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/AKfycbx.../exec
   ```
3. คลิก **Save**
4. **Redeploy** project (Deployments → คลิก ... → Redeploy)

### **5. ทดสอบ (Optional)**

ใน Apps Script Editor:
1. เลือกฟังก์ชัน **testDoPost**
2. คลิก **▶ Run**
3. Authorize permissions (คลิก Review → Go to HotelPlus Export → Allow)
4. เช็ค Execution log → ควรเห็น `{ "success": true, ... }`
5. เช็ค Spreadsheet → ควรมี Sheet "Jobs Export" พร้อม test data

---

## 📋 ข้อมูลที่ Export

| Column | Description |
|--------|-------------|
| Job ID | UUID ของงาน |
| User Name | ชื่อผู้ใช้ |
| User Email | อีเมลผู้ใช้ |
| Job Type | ประเภทงาน (text-to-image, custom-prompt, gpt-image, upscale) |
| Status | สถานะ (completed, failed) |
| Prompt | คำสั่งสร้างรูป |
| Template Type | ประเภท template (ถ้ามี) |
| Output Size | ขนาด output (x2, x4) |
| Input Images | จำนวนรูป input |
| Output Images | จำนวนรูป output |
| Created At | วันที่สร้างงาน (เวลาไทย) |
| Completed At | วันที่เสร็จสิ้น (เวลาไทย) |
| Duration (min) | ระยะเวลาประมวลผล (นาที) |
| Replicate ID | ID จาก Replicate API |
| Error | ข้อความ error (ถ้ามี) |

---

## 🔍 การทำงาน

### **Auto-Export Flow:**

1. User สร้างรูป → สร้าง Job ใน Database
2. Replicate API ประมวลผล
3. Webhook ได้รับ `status: completed`
4. อัพโหลดรูปไป Cloudinary
5. **📊 POST ข้อมูลไป Apps Script URL**
6. Apps Script append row ใน Google Sheets
7. Update job status

### **Export Timing:**

- ✅ Export ทุกครั้งที่ job **completed**
- ❌ ไม่ export job ที่ **processing**
- ✅ Export ทุกประเภท job (text-to-image, custom-prompt, gpt-image, gpt-with-template, upscale)

---

## ⚠️ Troubleshooting

### **1. Authorization Required**

```
Authorization needed
```

**แก้ไข:**
- รัน `testDoPost()` ใน Apps Script Editor
- Authorize permissions เมื่อมี popup
- ต้อง Allow access to Google Sheets

### **2. 404 Not Found**

```
Failed to export to Google Sheets: Not Found
```

**แก้ไข:**
- ตรวจสอบ URL ใน Vercel env vars
- ต้องเป็น URL ที่ลงท้ายด้วย `/exec` (ไม่ใช่ `/dev`)
- Redeploy Apps Script ใหม่แล้ว copy URL ใหม่

### **3. Permission Denied**

```
Exception: You do not have permission to call...
```

**แก้ไข:**
- ตั้ง "Execute as: **Me**"
- ตั้ง "Who has access: **Anyone**"
- Redeploy Web app

### **4. ไม่มีข้อมูล Export**

**เช็คว่า:**
```bash
# ใน Vercel env vars ต้องมี:
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/...
```

**ดู Logs:**
```
✅ Exported job to Google Sheets: [job_id]
⚠️ GOOGLE_SHEETS_WEBHOOK_URL not configured, skipping export
```

---

## 💡 ข้อดีของ Apps Script

✅ **ง่ายกว่า Service Account:**
- ไม่ต้องสร้าง Service Account
- ไม่ต้อง manage private keys
- ไม่ต้อง share spreadsheet
- ใช้ env แค่ตัวเดียว (URL)

✅ **Auto-create Sheet:**
- สร้าง "Jobs Export" sheet อัตโนมัติ
- เพิ่ม headers พร้อม format สวยงาม
- Freeze row แรกอัตโนมัติ

✅ **Error Handling:**
- Return JSON response ชัดเจน
- ใช้ try-catch ป้องกัน crash

---

## 🧪 ทดสอบการทำงาน

### **1. Test ใน Apps Script Editor:**
```javascript
// รัน testDoPost() function
// เช็ค Execution log และ Spreadsheet
```

### **2. Test จาก Production:**
```bash
# สร้างรูปใหม่ใน HotelPlus
# รอให้ job completed
# เช็คใน Google Sheets ว่ามีข้อมูลเพิ่มขึ้น
```

### **3. Test Manual POST:**
```bash
curl -X POST "https://script.google.com/macros/s/YOUR_ID/exec" \
  -H "Content-Type: application/json" \
  -d '{
    "jobId": "test-123",
    "userName": "Test",
    "userEmail": "test@example.com",
    "jobType": "text-to-image",
    "status": "completed",
    "prompt": "Test prompt",
    "templateType": "",
    "outputSize": "x2",
    "inputCount": 1,
    "outputCount": 2,
    "createdAt": "19/1/2026 15:30",
    "completedAt": "19/1/2026 15:32",
    "duration": 2,
    "replicateId": "rep-123",
    "error": ""
  }'
```

---

## 📊 Google Sheets Features

### **Auto-Header Formatting:**
- สีน้ำเงิน (#3399ff)
- ตัวหนา, ตัวอักษรสีขาว
- Freeze row แรก (ติดด้านบน)

### **Auto-append:**
- ข้อมูลใหม่ต่อท้ายอัตโนมัติ
- เรียงตามเวลาที่ส่งมา

---

## 🔒 Security

- Apps Script run with your permissions
- "Anyone" access = ไม่ต้อง auth
- เฉพาะ POST requests เท่านั้น (ไม่มี GET)
- ทำงานเฉพาะ Spreadsheet ที่เปิด Apps Script

---

**🎉 เสร็จแล้ว! ระบบจะ export อัตโนมัติทุกครั้งที่มี job เสร็จสิ้น**

---

## 📋 ข้อมูลที่ Export

| Column | Description |
|--------|-------------|
| Job ID | UUID ของงาน |
| User Name | ชื่อผู้ใช้ |
| User Email | อีเมลผู้ใช้ |
| Job Type | ประเภทงาน (text-to-image, custom-prompt, etc.) |
| Status | สถานะ (completed, failed) |
| Prompt | คำสั่งสร้างรูป |
| Template Type | ประเภท template (ถ้ามี) |
| Output Size | ขนาด output |
| Input Images | จำนวนรูป input |
| Output Images | จำนวนรูป output |
| Created At | วันที่สร้างงาน |
| Completed At | วันที่เสร็จสิ้น |
| Duration (min) | ระยะเวลาประมวลผล |
| Replicate ID | ID จาก Replicate API |
| Error | ข้อความ error (ถ้ามี) |

---

## 🔍 การทำงาน

### **Auto-Export Flow:**

1. User สร้างรูป → สร้าง Job ใน Database
2. Replicate API ประมวลผล
3. Webhook ได้รับ `status: completed`
4. อัพโหลดรูปไป Cloudinary
5. **📊 Export job ไป Google Sheets อัตโนมัติ**
6. Update job status

### **Export Timing:**

- ✅ Export ทุกครั้งที่ job **completed**
- ❌ ไม่ export job ที่ **processing**
- ❌ ไม่ export job ที่ **failed** (แต่มี error message)
- ✅ Export job ทุกประเภท (text-to-image, custom-prompt, gpt-image, upscale)

---

## ⚠️ Troubleshooting

### **1. Permission Denied Error**

```
Error: The caller does not have permission
```

**แก้ไข:**
- ตรวจสอบว่า Share Spreadsheet ให้ Service Account แล้ว
- ตรวจสอบว่าให้สิทธิ์ **Editor** (ไม่ใช่ Viewer)
- รอ 1-2 นาทีแล้วลองใหม่

### **2. Spreadsheet Not Found**

```
Error: Requested entity was not found
```

**แก้ไข:**
- ตรวจสอบ Spreadsheet ID ใน `.env.local`
- ตรวจสอบว่า Spreadsheet ยังมีอยู่

### **3. Invalid Range Error**

```
Error: Unable to parse range
```

**แก้ไข:**
- ตรวจสอบว่ามี Sheet ชื่อ "Jobs Export"
- หรือเปลี่ยนชื่อใน code: `sheetName: 'Jobs Export'`

### **4. ไม่มีข้อมูล Export**

**เช็คว่า:**
```bash
# ใน .env.local ต้องมี:
GOOGLE_SHEETS_EXPORT_SPREADSHEET_ID=...
```

**ดู Logs:**
```
✅ Exported job to Google Sheets: [job_id]
⚠️ GOOGLE_SHEETS_EXPORT_SPREADSHEET_ID not configured, skipping export
```

---

## 🧪 ทดสอบ

### **1. ทดสอบ Manual Export:**

ใช้ API endpoint:
```bash
curl -X POST http://localhost:3000/api/export/sheets \
  -H "Content-Type: application/json" \
  -d '{
    "spreadsheetId": "YOUR_SPREADSHEET_ID",
    "sheetName": "Jobs Export"
  }'
```

### **2. ทดสอบ Auto-Export:**

1. สร้างรูปใหม่จากหน้า GPT Image / Custom Prompt
2. รอให้ Replicate ประมวลผลเสร็จ
3. เช็คใน Google Sheets ว่ามีข้อมูลเพิ่มขึ้น

---

## 📊 Google Sheets Features

### **Header Formatting:**
- สีน้ำเงิน (#3399ff)
- ตัวหนา
- ตัวอักษรสีขาว
- Freeze row (แถวแรกติดด้านบน)

### **Auto-append:**
- ข้อมูลใหม่ต่อท้ายอัตโนมัติ
- ไม่ซ้ำ (ตาม Job ID)
- เรียงตามเวลาสร้าง

---

## 🔐 Security

- ใช้ Service Account (ไม่ใช้ OAuth)
- Scope: `spreadsheets` และ `drive.file` เท่านั้น
- ไม่เข้าถึง Spreadsheet อื่นที่ไม่ได้ Share

---

## 💡 Tips

1. **Multiple Sheets**: สามารถ export ไปหลาย Sheet ได้ (แก้ `sheetName`)
2. **Data Analysis**: ใช้ Google Sheets Formulas/Charts วิเคราะห์ข้อมูล
3. **Backup**: Download เป็น CSV เพื่อ backup
4. **Sharing**: Share Spreadsheet กับทีมเพื่อดูข้อมูล real-time

---

**🎉 เสร็จแล้ว! ระบบจะ export อัตโนมัติทุกครั้งที่มี job เสร็จสิ้น**
