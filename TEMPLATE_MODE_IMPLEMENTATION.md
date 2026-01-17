# Template Mode Implementation for GPT Image

## Overview
เพิ่ม Template Mode ให้กับ GPT Image page โดยแยกระบบออกจาก Custom Prompt อย่างชัดเจน

## Features Added
1. ✅ Template Mode toggle switch
2. ✅ Template selection from Google Drive folders
3. ✅ Template upload from local files (with compression)
4. ✅ Selected template display and delete
5. ✅ Conditional API routing (GPT Image 1.5 vs Nano Banana Pro)
6. ✅ Separate job_type: 'gpt-image-with-template'

## Implementation Details

### State Variables (Lines 51-54)
```typescript
const [useTemplateMode, setUseTemplateMode] = useState(false)
const [templateImage, setTemplateImage] = useState<DriveImage | null>(null)
const [templateFolderId, setTemplateFolderId] = useState('')
const [templateImages, setTemplateImages] = useState<DriveImage[]>([])
```

### Helper Function (Lines 274-299)
```typescript
async function loadTemplateImages()
```
- โหลดรูปจากโฟลเดอร์ที่เลือก
- แปลง Drive API response เป็น DriveImage objects
- จัดการ error และ loading states

### Conditional Logic in handleCreate() (Lines 332-417)
```typescript
if (useTemplateMode && templateImage) {
  // Template Mode: Use Nano Banana Pro
  job_type: 'gpt-image-with-template'
  API: /api/replicate/custom-prompt
  return // Exit early
}
// Normal Mode: Use GPT Image 1.5 (unchanged)
job_type: 'gpt-image'
API: /api/replicate/gpt-image
```

### UI Components (Lines 652-858)
1. **Toggle Switch** - Enable/disable template mode
2. **Warning Banner** - เตือนว่าจะใช้ Nano Banana Pro model
3. **Drive Folder Selector** - เลือกโฟลเดอร์ template
4. **Template Grid** - แสดง templates พร้อม selection
5. **Upload Button** - อัพโหลด template จากเครื่อง (with compression)
6. **Selected Display** - แสดง template ที่เลือก + ปุ่มลบ

## Separation Guarantees

### 1. Different job_type
- Custom Prompt: `'custom-prompt'` และ `'custom-prompt-template'`
- GPT Image Template: `'gpt-image-with-template'`
- GPT Image Normal: `'gpt-image'`

### 2. Different Code Paths
- Template Mode: Early return ในบรรทัด 415
- Normal Mode: ดำเนินการตามปกติ (ไม่มีการแก้ไขโค้ดเดิม)

### 3. Different API Endpoints
- Template Mode → `/api/replicate/custom-prompt`
- Normal Mode → `/api/replicate/gpt-image`

### 4. Independent State Management
- Template states เป็นตัวแปรแยก
- Normal mode states ไม่ได้รับผลกระทบ
- การเปิด/ปิด template mode จะ clear template states

## Database Schema
Jobs table รองรับ job_type ใดๆ (TEXT type) ไม่ต้องแก้ schema

## Image Compression Flow
1. Client-side: browser-image-compression (>3MB → 3MB)
2. Server-side: Sharp compression in /api/upload-images (>8MB → optimized)
3. Final upload: Cloudinary

## Testing Checklist
- [x] TypeScript errors checked (only img tag warnings)
- [ ] Template Mode: Drive folder selection
- [ ] Template Mode: Template upload
- [ ] Template Mode: Template deletion
- [ ] Template Mode: Job creation
- [ ] Normal Mode: Unchanged functionality
- [ ] Custom Prompt: Unaffected
- [ ] Dashboard: Display all job types correctly

## File Changes
- ✅ `app/gpt-image/page.tsx` - Main implementation (1266 lines)
- ✅ No changes to other files
- ✅ No database schema changes needed

## API Reuse
- `/api/replicate/custom-prompt` - Reused for template mode
- `/api/upload-images` - Used for template uploads
- `/api/drive/list-folder` - Used for loading templates
- `/api/drive/download-and-upload` - Converts Drive URLs

## Notes
- Template Mode ใช้ Nano Banana Pro เพื่อความแม่นยำในการยึดติด template
- Normal Mode ยังคงใช้ GPT Image 1.5 เหมือนเดิม
- การตั้งค่าอื่นๆ (aspect ratio, quality, etc.) จะไม่ถูกใช้ใน Template Mode
- System มีความ robust ด้วย error handling ครบทุกจุด
