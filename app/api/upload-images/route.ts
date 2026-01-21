import { NextRequest, NextResponse } from 'next/server'
import { v2 as cloudinary } from 'cloudinary'
import sharp from 'sharp'

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

// 🔥 Increase limits for large image uploads (Hobby plan max: 60s)
export const maxDuration = 60 // 60 seconds (Vercel Hobby limit)
export const dynamic = 'force-dynamic'

// Helper function to sanitize filename
function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_') // Replace special chars with underscore
    .replace(/_{2,}/g, '_') // Replace multiple underscores with single
    .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
}

// 🔥 Smart compression ที่รักษาคุณภาพหน้าคน
async function smartCompress(buffer: Buffer): Promise<{ buffer: Buffer; mimeType: string }> {
  // 🔥 STRATEGY: บีบไฟล์ให้เหลือไม่เกิน 10MB สำหรับ Cloudinary
  // แต่รักษาขนาด dimension ใหญ่เพื่อให้หน้าคนชัด
  
  const targetSizeMB = 10 // Cloudinary free plan limit
  const sizeMB = buffer.length / (1024 * 1024)
  
  // ถ้าไฟล์เล็กอยู่แล้ว ใช้ quality สูงสุด
  if (sizeMB <= targetSizeMB) {
    const result = await sharp(buffer, { failOnError: false })
      .jpeg({ quality: 95, mozjpeg: true }) // 🔥 quality สูงสุด
      .toBuffer()
    return { buffer: result, mimeType: 'image/jpeg' }
  }
  
  // 🔥 ไฟล์ใหญ่: ใช้ progressive compression
  // เริ่มจาก quality สูง แล้วลดลงจนกว่าจะได้ขนาดที่ต้องการ
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
  
  // 🔥 ยังใหญ่เกินไป? ลด dimension แต่รักษาหน้าคน (4K)
  const result = await sharp(buffer, { failOnError: false })
    .resize(3840, 3840, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer()
  
  return { buffer: result, mimeType: 'image/jpeg' }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const files = formData.getAll('files') as File[]

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files uploaded' }, { status: 400 })
    }

    const uploadedImages = []

    for (const file of files) {
      const sanitizedName = sanitizeFilename(file.name)
      const bytes = await file.arrayBuffer()
      let buffer = Buffer.from(bytes)
      const originalSizeMB = (buffer.length / (1024 * 1024)).toFixed(2)
      
      console.log(`📤 Uploading: ${sanitizedName} (original: ${file.name}, ${originalSizeMB}MB, type: ${file.type})`)
      
      // 🔥 ตรวจสอบว่าเป็น HEIC/HEIF หรือไฟล์ใหญ่
      const isHeic = file.type === 'image/heic' || 
                     file.type === 'image/heif' ||
                     file.name.toLowerCase().endsWith('.heic') ||
                     file.name.toLowerCase().endsWith('.heif')
      
      const needsProcessing = buffer.length > 10 * 1024 * 1024 || isHeic
      
      let mimeType = 'image/jpeg'
      
      if (needsProcessing) {
        console.log(`🔄 Processing large/HEIC image: ${sanitizedName}`)
        
        try {
          // 🔥 ใช้ smart compression ที่รักษาคุณภาพหน้าคน
          const result = await smartCompress(buffer)
          buffer = Buffer.from(result.buffer)
          mimeType = result.mimeType
          
          const compressedSizeMB = (buffer.length / (1024 * 1024)).toFixed(2)
          console.log(`✅ Smart compressed: ${originalSizeMB}MB → ${compressedSizeMB}MB`)
        } catch (err) {
          console.error(`❌ Failed to process ${sanitizedName}:`, err)
          throw new Error(`Failed to process image: ${sanitizedName}`)
        }
      } else {
        // 🔥 ไฟล์เล็ก: แค่แปลงเป็น JPEG quality สูง
        try {
          const processed = await sharp(buffer, { failOnError: false })
            .jpeg({ quality: 95, mozjpeg: true })
            .toBuffer()
          buffer = Buffer.from(processed)
        } catch (err) {
          console.log(`⚠️ Sharp failed, using original:`, err)
        }
      }
      
      const base64 = buffer.toString('base64')
      const dataUri = `data:${mimeType};base64,${base64}`

      const result = await cloudinary.uploader.upload(dataUri, {
        folder: 'hotelplus-v2',
        resource_type: 'image',
        public_id: `${Date.now()}_${sanitizedName.replace(/\.[^/.]+$/, '')}`, // Use sanitized name without extension
      })

      uploadedImages.push({
        id: result.public_id,
        name: file.name, // Keep original name for display
        url: result.secure_url,
        thumbnailUrl: result.secure_url.replace('/upload/', '/upload/w_300,h_300,c_fill/'),
      })
      
      console.log(`✅ Uploaded successfully: ${sanitizedName}`)
    }

    return NextResponse.json({ 
      success: true, 
      images: uploadedImages 
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: 'Failed to upload images' },
      { status: 500 }
    )
  }
}
