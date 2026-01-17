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
    
    // Always process through sharp to:
    // 1. Convert HEIC/HEIF to JPEG (iOS compatibility)
    // 2. Compress large files > 8MB
    // 3. Ensure consistent JPEG output for Replicate
    const isHeic = fileName.toLowerCase().endsWith('.heic') || fileName.toLowerCase().endsWith('.heif')
    const needsProcessing = buffer.length > 8 * 1024 * 1024 || isHeic
    
    if (needsProcessing) {
      console.log(`🔄 Processing image: ${fileName}${isHeic ? ' (HEIC → JPEG)' : ''}`)
      
      try {
        // Convert to JPEG and optionally compress
        const compressedBuffer = await sharp(buffer)
          .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer()
        
        buffer = Buffer.from(compressedBuffer)
        
        const compressedSizeMB = (buffer.length / (1024 * 1024)).toFixed(2)
        console.log(`✅ Processed: ${originalSizeMB}MB → ${compressedSizeMB}MB (JPEG)`)
      } catch (err) {
        console.error(`❌ Failed to process ${fileName}:`, err)
        throw new Error(`Failed to process image: ${fileName}`)
      }
    }
    
    const base64String = `data:image/jpeg;base64,${buffer.toString('base64')}`
    
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
