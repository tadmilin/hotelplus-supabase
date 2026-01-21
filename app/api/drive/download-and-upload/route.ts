import { NextRequest, NextResponse } from 'next/server'
import { getDriveClient } from '@/lib/google-drive'
import { uploadBase64ToCloudinary } from '@/lib/cloudinary'
import sharp from 'sharp'
import { GaxiosResponse } from 'gaxios'

export async function POST(req: NextRequest) {
  let attempt = 0
  const maxAttempts = 2
  
  while (attempt < maxAttempts) {
    attempt++
    
    try {
      const { fileId, fileName } = await req.json()

      if (!fileId) {
        return NextResponse.json({ error: 'File ID required' }, { status: 400 })
      }

      // Sanitize filename
      const sanitizedName = (fileName || 'untitled.jpg').replace(/[^\w\s.-]/gi, '_').replace(/\s+/g, '_')
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
      
      // ถ้าไฟล์ใหญ่มากๆ (>20MB) → บีบแรงสุด
      const ext = sanitizedName.toLowerCase().split('.').pop() || 'jpg'
      const isHeic = ext === 'heic' || ext === 'heif'
      const isGif = ext === 'gif'
      const isPng = ext === 'png'
      const isWebp = ext === 'webp'
      
      // GIF ไม่จับยุ่ง
      if (isGif) {
        console.log(`🎬 GIF: Upload as-is`)
        const base64 = buffer.toString('base64')
        const url = await uploadBase64ToCloudinary(`data:image/gif;base64,${base64}`, 'hotelplus-v2')
        return NextResponse.json({ url })
      }
      
      // HEIC → ให้ Cloudinary handle
      if (isHeic) {
        console.log(`🔄 HEIC: Let Cloudinary convert`)
        const base64 = buffer.toString('base64')
        const url = await uploadBase64ToCloudinary(`data:application/octet-stream;base64,${base64}`, 'hotelplus-v2')
        return NextResponse.json({ url })
      }
      
      // รูปอื่นๆ → บีบตามขนาด
      let mimeType = 'image/jpeg'
      let maxDimension = 3000
      let quality = 85
      
      // ไฟล์ใหญ่ → บีบแรงขึ้น
      if (buffer.length > 20 * 1024 * 1024) {
        maxDimension = 2500
        quality = 75
        console.log(`🔥 Large file (${originalSizeMB}MB): Aggressive compression`)
      } else if (buffer.length > 10 * 1024 * 1024) {
        maxDimension = 2800
        quality = 80
        console.log(`🔄 Medium file (${originalSizeMB}MB): Moderate compression`)
      } else {
        console.log(`✅ Small file (${originalSizeMB}MB): Minimal compression`)
      }
      
      try {
        let sharpInstance = sharp(buffer, { failOnError: false })
          .resize(maxDimension, maxDimension, { 
            fit: 'inside', 
            withoutEnlargement: true 
          })
        
        // เลือก format
        if (isPng && buffer.length < 5 * 1024 * 1024) {
          // PNG เล็ก → รักษา PNG
          sharpInstance = sharpInstance.png({ quality, compressionLevel: 9 })
          mimeType = 'image/png'
        } else if (isWebp) {
          sharpInstance = sharpInstance.webp({ quality })
          mimeType = 'image/webp'
        } else {
          // Default: JPEG (รองรับทุกอย่าง)
          sharpInstance = sharpInstance.jpeg({ quality, mozjpeg: true })
          mimeType = 'image/jpeg'
        }
        
        buffer = await sharpInstance.toBuffer()
        let finalSizeMB = (buffer.length / (1024 * 1024)).toFixed(2)
        console.log(`✅ Processed: ${originalSizeMB}MB → ${finalSizeMB}MB`)
        
        // 🔥 Cloudinary Base64 limit: ~60MB (~45MB after encoding)
        const maxBase64Size = 45 * 1024 * 1024 // 45MB safe limit
        if (buffer.length > maxBase64Size) {
          console.log(`⚠️ File too large (${finalSizeMB}MB > 45MB), compressing harder...`)
          
          // บีบแรงสุด: 2000px, quality 60
          buffer = await sharp(buffer, { failOnError: false })
            .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 60, mozjpeg: true })
            .toBuffer()
          
          finalSizeMB = (buffer.length / (1024 * 1024)).toFixed(2)
          mimeType = 'image/jpeg'
          console.log(`✅ Extra compression: ${finalSizeMB}MB`)
          
          // ถ้ายังใหญ่ → error
          if (buffer.length > maxBase64Size) {
            throw new Error(`File too large after compression: ${finalSizeMB}MB (max 45MB for upload)`)
          }
        }
        
      } catch (sharpError) {
        console.error(`⚠️ Sharp processing failed:`, sharpError)
        // ถ้า Sharp ล้ม → แปลงเป็น JPEG อย่างเดียว
        try {
          buffer = await sharp(buffer, { failOnError: false })
            .jpeg({ quality: 70 })
            .toBuffer()
          mimeType = 'image/jpeg'
          console.log(`✅ Fallback: Converted to JPEG`)
        } catch {
          // ถ้ายัง fail → อัพโหลดต้นฉบับ
          console.log(`⚠️ Using original buffer`)
        }
      }
      
      const base64 = `data:${mimeType};base64,${buffer.toString('base64')}`
      
      // Upload to Cloudinary with retry
      console.log(`☁️ Uploading to Cloudinary...`)
      try {
        const url = await uploadBase64ToCloudinary(base64, 'hotelplus-v2')
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
