import { NextRequest, NextResponse } from 'next/server'
import { getDriveClient } from '@/lib/google-drive'
import { uploadImageFullSize } from '@/lib/cloudinary' // 🔥 ใช้ full-size เพื่อรักษาคุณภาพหน้าคน
import sharp from 'sharp'
import { GaxiosResponse } from 'gaxios'

// 🔥 Vercel Hobby plan limit: 60 seconds
export const maxDuration = 60

// 🔥 Smart compression ที่รักษาคุณภาพหน้าคน
// ใช้ quality-based compression ก่อน resize
async function smartCompress(buffer: Buffer): Promise<{ buffer: Buffer; mimeType: string }> {
  const targetSizeMB = 10 // Cloudinary limit
  const sizeMB = buffer.length / (1024 * 1024)
  
  // ถ้าไฟล์เล็กอยู่แล้ว ใช้ quality สูงสุด
  if (sizeMB <= targetSizeMB) {
    const result = await sharp(buffer, { failOnError: false })
      .jpeg({ quality: 95, mozjpeg: true })
      .toBuffer()
    return { buffer: result, mimeType: 'image/jpeg' }
  }
  
  // 🔥 ไฟล์ใหญ่: ใช้ progressive compression (ลด quality ก่อน, ไม่ลด dimension)
  const qualityLevels = [90, 85, 80, 75, 70, 65]
  
  for (const quality of qualityLevels) {
    const result = await sharp(buffer, { failOnError: false })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer()
    
    const resultSizeMB = result.length / (1024 * 1024)
    console.log(`  📦 Quality ${quality}: ${resultSizeMB.toFixed(2)}MB`)
    
    if (resultSizeMB <= targetSizeMB) {
      return { buffer: result, mimeType: 'image/jpeg' }
    }
  }
  
  // 🔥 ยังใหญ่เกินไป? ลด dimension แต่ยังรักษา 4K (3840px)
  const result = await sharp(buffer, { failOnError: false })
    .resize(3840, 3840, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer()
  
  return { buffer: result, mimeType: 'image/jpeg' }
}

export async function POST(req: NextRequest) {
  // 🔥 อ่าน body ก่อน retry loop เพื่อไม่ให้เกิด "Body has already been read"
  const { fileId, fileName } = await req.json()

  if (!fileId) {
    return NextResponse.json({ error: 'File ID required' }, { status: 400 })
  }

  // Sanitize filename
  const sanitizedName = (fileName || 'untitled.jpg').replace(/[^\w\s.-]/gi, '_').replace(/\s+/g, '_')
  
  let attempt = 0
  const maxAttempts = 2
  
  while (attempt < maxAttempts) {
    attempt++
    
    try {
      console.log(`📂 [Attempt ${attempt}/${maxAttempts}] Processing: ${sanitizedName}`)

      const drive = getDriveClient()

      if (!drive) {
        return NextResponse.json({ error: 'Google Drive not configured' }, { status: 503 })
      }

      // Download with aggressive timeout and retry
      console.log(`⬇️ Downloading: ${fileId}`)
      let response: GaxiosResponse<ArrayBuffer>
      try {
        response = await drive.files.get(
          { fileId, alt: 'media' },
          { 
            responseType: 'arraybuffer' as 'json', 
            timeout: 90000, // 90 seconds
          }
        ) as GaxiosResponse<ArrayBuffer>
      } catch (downloadError) {
        console.error(`❌ Download failed (attempt ${attempt}):`, downloadError)
        if (attempt < maxAttempts) {
          console.log(`🔄 Retrying in 2 seconds...`)
          await new Promise(resolve => setTimeout(resolve, 2000))
          continue
        }
        throw downloadError
      }

      let buffer: Buffer = Buffer.from(response.data as ArrayBuffer)
      const originalSizeMB = (buffer.length / (1024 * 1024)).toFixed(2)
      console.log(`📥 Downloaded: ${originalSizeMB}MB`)
      
      // 🔥 ตรวจสอบ format พิเศษ
      const ext = sanitizedName.toLowerCase().split('.').pop() || 'jpg'
      const isHeic = ext === 'heic' || ext === 'heif'
      const isGif = ext === 'gif'
      
      // GIF ไม่จับยุ่ง - 🔥 ใช้ full-size
      if (isGif) {
        console.log(`🎬 GIF: Upload as-is (full-size)`)
        const base64 = buffer.toString('base64')
        const url = await uploadImageFullSize(`data:image/gif;base64,${base64}`, 'hotelplus-v2')
        return NextResponse.json({ url })
      }
      
      // HEIC → ให้ Cloudinary handle - 🔥 ใช้ full-size
      if (isHeic) {
        console.log(`🔄 HEIC: Let Cloudinary convert (full-size)`)
        const base64 = buffer.toString('base64')
        const url = await uploadImageFullSize(`data:application/octet-stream;base64,${base64}`, 'hotelplus-v2')
        return NextResponse.json({ url })
      }
      
      // 🔥 รูปอื่นๆ → ใช้ Smart Compression ที่รักษาคุณภาพหน้าคน
      let mimeType = 'image/jpeg'
      
      try {
        console.log(`🔄 Smart compressing: ${originalSizeMB}MB...`)
        const result = await smartCompress(buffer)
        buffer = result.buffer
        mimeType = result.mimeType
        
        const finalSizeMB = (buffer.length / (1024 * 1024)).toFixed(2)
        console.log(`✅ Smart compressed: ${originalSizeMB}MB → ${finalSizeMB}MB`)
        
      } catch (sharpError) {
        console.error(`⚠️ Sharp processing failed:`, sharpError)
        // ถ้า Sharp ล้ม → แปลงเป็น JPEG อย่างเดียว
        try {
          buffer = await sharp(buffer, { failOnError: false })
            .jpeg({ quality: 85 })
            .toBuffer()
          mimeType = 'image/jpeg'
          console.log(`✅ Fallback: Converted to JPEG`)
        } catch {
          // ถ้ายัง fail → อัพโหลดต้นฉบับ
          console.log(`⚠️ Using original buffer`)
        }
      }
      
      const base64 = `data:${mimeType};base64,${buffer.toString('base64')}`
      
      // Upload to Cloudinary with retry - 🔥 ใช้ full-size เพื่อรักษาคุณภาพหน้าคน
      console.log(`☁️ Uploading to Cloudinary (full-size)...`)
      try {
        const url = await uploadImageFullSize(base64, 'hotelplus-v2')
        console.log(`✅ Success: ${url}`)
        return NextResponse.json({ url })
      } catch (uploadError) {
        console.error(`❌ Cloudinary upload failed:`, uploadError)
        if (attempt < maxAttempts) {
          console.log(`🔄 Retrying upload...`)
          await new Promise(resolve => setTimeout(resolve, 2000))
          continue
        }
        throw uploadError
      }
      
    } catch (error) {
      console.error(`❌ Error (attempt ${attempt}/${maxAttempts}):`, error)
      
      if (attempt >= maxAttempts) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        return NextResponse.json(
          { error: `Failed after ${maxAttempts} attempts: ${errorMessage}` },
          { status: 500 }
        )
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
  
  return NextResponse.json({ error: 'Failed to process file' }, { status: 500 })
}
