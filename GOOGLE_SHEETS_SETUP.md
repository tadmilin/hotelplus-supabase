# 📊 Google Sheets Auto-Export Setup

ระบบจะ export ข้อมูล jobs อัตโนมัติไปยัง Google Sheets ทุกครั้งที่ job เสร็จสิ้น

---

## 🎯 ขั้นตอนการตั้งค่า

### **1. สร้าง Google Spreadsheet**

1. ไปที่ https://sheets.google.com
2. คลิก **+ Blank** เพื่อสร้าง Spreadsheet ใหม่
3. ตั้งชื่อว่า "HotelPlus Jobs Export" (หรือชื่ออื่นตามต้องการ)
4. สร้าง Sheet ชื่อ "Jobs Export" (หรือเปลี่ยนชื่อ Sheet1)

### **2. คัดลอก Spreadsheet ID**

จาก URL ของ Spreadsheet:
```
https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit
```

เช่น: `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms`

### **3. Share Spreadsheet กับ Service Account**

1. คลิก **Share** (ปุ่มสีเขียวมุมบนขว่า)
2. เพิ่ม Email: `ai-backend@testapi-480011.iam.gserviceaccount.com`
   (หรือ Service Account Email ของคุณ)
3. เลือกสิทธิ์: **Editor**
4. คลิก **Send**

### **4. เพิ่ม Environment Variable**

เพิ่มใน `.env.local`:

```bash
GOOGLE_SHEETS_EXPORT_SPREADSHEET_ID=your_spreadsheet_id_here
```

### **5. Restart Server**

```bash
npm run dev
```

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
