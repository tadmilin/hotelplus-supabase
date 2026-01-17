import { NextRequest, NextResponse } from 'next/server'
import { getDriveClient } from '@/lib/google-drive'
import { uploadBase64ToCloudinary } from '@/lib/cloudinary'
import sharp from 'sharp'

export async function POST(req: NextRequest) {
  try {
    const { fileId, fileName } = await req.json()

    if (!fileId) {
      return NextResponse.json({ error: 'File ID required' }, { status: 400 })
    }

    const drive = getDriveClient()

    if (!drive) {
      return NextResponse.json({ error: 'Google Drive not configured' }, { status: 503 })
    }

    // Download file from Drive
    const response = await drive.files.get(
      {
        fileId: fileId,
        alt: 'media',
      },
      { responseType: 'arraybuffer' }
    )

    let buffer = Buffer.from(response.data as ArrayBuffer)
    const originalSizeMB = (buffer.length / (1024 * 1024)).toFixed(2)
    
    console.log(`📥 Downloaded: ${fileName} (${originalSizeMB}MB)`)
    
    // ตรวจสอบประเภทไฟล์
    const isHeic = fileName.toLowerCase().endsWith('.heic') || fileName.toLowerCase().endsWith('.heif')
    const needsCompression = buffer.length > 8 * 1024 * 1024
    
    // ถ้าเป็น HEIC → อัพโหลดตรงไป Cloudinary (ข้าม Sharp)
    if (isHeic) {
      console.log(`⚠️ HEIC detected: Uploading directly to Cloudinary (will convert to JPEG)`)
      const base64String = buffer.toString('base64')
      // ไม่ระบุ mime type เพราะ Cloudinary จะแปลงเป็น JPEG อัตโนมัติ (format: 'jpg')
      const cloudinaryUrl = await uploadBase64ToCloudinary(`data:application/octet-stream;base64,${base64String}`, 'hotelplus-v2')
      console.log(`✅ HEIC uploaded and converted to JPEG: ${originalSizeMB}MB`)
      return NextResponse.json({ url: cloudinaryUrl })
    }
    
    // ไม่ใช่ HEIC → ประมวลผลด้วย Sharp (ถ้าใหญ่เกิน 8MB)
    let mimeType = 'image/jpeg'
    
    if (needsCompression) {
      console.log(`🔄 Compressing: ${fileName} (${originalSizeMB}MB > 8MB)`)
      
      try {
        const compressedBuffer = await sharp(buffer)
          .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer()
        
        buffer = Buffer.from(compressedBuffer)
        
        const compressedSizeMB = (buffer.length / (1024 * 1024)).toFixed(2)
        console.log(`✅ Compressed: ${originalSizeMB}MB → ${compressedSizeMB}MB`)
      } catch (err) {
        console.error(`❌ Compression failed for ${fileName}:`, err)
        throw new Error(`Failed to compress image: ${fileName}`)
      }
    } else {
      // ไฟล์เล็ก ไม่ compress → ใช้ mime type เดิม
      if (fileName.toLowerCase().endsWith('.png')) {
        mimeType = 'image/png'
      } else if (fileName.toLowerCase().endsWith('.webp')) {
        mimeType = 'image/webp'
      }
      console.log(`✅ No compression needed: ${originalSizeMB}MB`)
    }
    
    const base64String = `data:${mimeType};base64,${buffer.toString('base64')}`
    
    // Upload to Cloudinary
    const cloudinaryUrl = await uploadBase64ToCloudinary(base64String, 'hotelplus-v2')

    return NextResponse.json({ url: cloudinaryUrl })
  } catch (error) {
    console.error('Error downloading and uploading:', error)
    return NextResponse.json(
      { error: 'Failed to download and upload file' },
      { status: 500 }
    )
  }
}
