import { NextRequest, NextResponse } from 'next/server'
import { v2 as cloudinary } from 'cloudinary'
import sharp from 'sharp'

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

// Increase body size limit and timeout for large image uploads (Next.js 13+ App Router)
export const maxDuration = 60 // seconds
export const dynamic = 'force-dynamic'

// Helper function to sanitize filename
function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_') // Replace special chars with underscore
    .replace(/_{2,}/g, '_') // Replace multiple underscores with single
    .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
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
      
      // Always process through sharp to:
      // 1. Convert HEIC/HEIF to JPEG (iOS compatibility)
      // 2. Compress large files > 15MB
      // 3. Ensure consistent JPEG output for Replicate
      const needsProcessing = buffer.length > 15 * 1024 * 1024 || 
                              file.type === 'image/heic' || 
                              file.type === 'image/heif' ||
                              file.name.toLowerCase().endsWith('.heic') ||
                              file.name.toLowerCase().endsWith('.heif')
      
      if (needsProcessing) {
        console.log(`🔄 Processing image: ${sanitizedName}`)
        
        try {
          // Convert to JPEG and optionally compress
          // Use higher quality (90) and larger max size (3840x3840 for 4K)
          const compressedBuffer = await sharp(buffer)
            .resize(3840, 3840, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 90, progressive: true })
            .toBuffer()
          
          buffer = Buffer.from(compressedBuffer)
          
          const compressedSizeMB = (buffer.length / (1024 * 1024)).toFixed(2)
          console.log(`✅ Processed: ${originalSizeMB}MB → ${compressedSizeMB}MB (JPEG)`)
        } catch (err) {
          console.error(`❌ Failed to process ${sanitizedName}:`, err)
          throw new Error(`Failed to process image: ${sanitizedName}`)
        }
      }
      
      const base64 = buffer.toString('base64')
      const dataUri = `data:image/jpeg;base64,${base64}`

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
