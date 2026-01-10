# 🔍 ตรวจสอบทุกอย่างอย่างละเอียด

## ❌ ปัญหาที่พบ:

### 1. **Webhook Signature Verification ไม่ทำงาน**
```typescript
if (webhookSecret) {
  // ตรวจสอบ headers แต่ไม่ได้ VERIFY signature จริงๆ
  // แค่ return error ถ้าไม่มี header
  // ไม่ได้เช็ค signature ว่าถูกต้องหรือไม่
}
```
**ผลกระทบ:** Replicate ส่ง webhook มาแต่ถูกปฏิเสธเพราะไม่มีการ verify ที่ถูกต้อง

### 2. **RLS Policy สำหรับ Service Role ไม่มีผล**
```sql
CREATE POLICY "Service role can update all jobs"
  USING (auth.jwt() ->> 'role' = 'service_role');
```
**ปัญหา:** `auth.jwt()` ไม่ทำงานกับ service_role_key  
**ต้องเป็น:** ปิด RLS หรือเพิ่ม USING (true) สำหรับ service role

### 3. **Realtime Subscription + RLS Conflict**
Dashboard subscribe แต่ RLS block events → ไม่ได้รับ updates

## ✅ วิธีแก้ที่ถูกต้อง:

### Step 1: ปิด RLS สำหรับ Service Role
```sql
-- ลบ policies เดิมที่ไม่ทำงาน
DROP POLICY IF EXISTS "Service role can update all jobs" ON public.jobs;
DROP POLICY IF EXISTS "Service role can insert jobs" ON public.jobs;

-- เพิ่ม policy ที่ bypass RLS สำหรับ service_role
-- วิธีที่ 1: ใช้ USING (true) แต่ต้อง authenticated
CREATE POLICY "Allow authenticated updates"
  ON public.jobs
  FOR UPDATE
  USING (true);

-- หรือวิธีที่ 2: ปิด RLS เมื่อใช้ service_role ใน code
-- (ทำใน webhook handler)
```

### Step 2: แก้ Webhook Handler
```typescript
// ใช้ .from('jobs').update().eq('id', job.id)
// แทนที่จะใช้ RLS, ให้ service_role bypass
```

### Step 3: แก้ Realtime Subscription
เพิ่ม filter และ user dependency

---

## 📝 สรุป:
ปัญหาหลักคือ **Service Role Authentication ไม่ทำงานกับ RLS policies** ที่เขียนไว้
