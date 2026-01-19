import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getDriveClient } from '@/lib/google-drive'
import { uploadBase64ToCloudinary } from '@/lib/cloudinary'
import sharp from 'sharp'

// Create Supabase admin client
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const fileId = searchParams.get('fileId')
    const fileName = searchParams.get('fileName') || 'unknown'

    if (!fileId) {
      return NextResponse.json({ error: 'File ID required' }, { status: 400 })
    }

    // Check cache first
    const { data: cachedFile, error: cacheError } = await supabaseAdmin
      .from('drive_cache')
      .select('*')
      .eq('drive_file_id', fileId)
      .single()

    if (cachedFile && !cacheError) {
      console.log(`✅ Cache HIT: ${fileName} (${fileId})`)
      
      // Update access stats (async, don't wait)
      supabaseAdmin.rpc('update_drive_cache_access', { cache_id: cachedFile.id }).then(() => {
        console.log(`📊 Updated access count for ${fileName}`)
      })

      return NextResponse.json({
        url: cachedFile.cloudinary_url,
        cached: true,
        fileName: cachedFile.file_name,
      })
    }

    console.log(`❌ Cache MISS: ${fileName} (${fileId}) - Downloading from Drive...`)

    // Cache miss - download and upload
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
    const fileSizeBytes = buffer.length
    
    console.log(`📥 Downloaded: ${fileName} (${originalSizeMB}MB)`)
    
    // Check file type
    const isHeic = fileName.toLowerCase().endsWith('.heic') || fileName.toLowerCase().endsWith('.heif')
    const needsCompression = buffer.length > 8 * 1024 * 1024
    
    let cloudinaryUrl: string
    let publicId: string | undefined
    
    // HEIC → Upload directly to Cloudinary (will auto-convert to JPEG)
    if (isHeic) {
      console.log(`⚠️ HEIC detected: Uploading directly to Cloudinary`)
      const base64String = buffer.toString('base64')
      cloudinaryUrl = await uploadBase64ToCloudinary(
        `data:application/octet-stream;base64,${base64String}`,
        'hotelplus-v2'
      )
      console.log(`✅ HEIC uploaded and converted to JPEG`)
    } else {
      // Process with Sharp if needed
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
        // Small file - keep original format
        if (fileName.toLowerCase().endsWith('.png')) {
          mimeType = 'image/png'
        } else if (fileName.toLowerCase().endsWith('.webp')) {
          mimeType = 'image/webp'
        }
        console.log(`✅ No compression needed: ${originalSizeMB}MB`)
      }
      
      const base64String = `data:${mimeType};base64,${buffer.toString('base64')}`
      cloudinaryUrl = await uploadBase64ToCloudinary(base64String, 'hotelplus-v2')
    }

    // Extract public_id from Cloudinary URL
    try {
      const urlParts = cloudinaryUrl.split('/')
      const lastPart = urlParts[urlParts.length - 1]
      publicId = lastPart.split('.')[0]
    } catch (err) {
      console.warn('Could not extract Cloudinary public_id:', err)
    }

    // Save to cache
    const { error: insertError } = await supabaseAdmin
      .from('drive_cache')
      .insert({
        drive_file_id: fileId,
        file_name: fileName,
        cloudinary_url: cloudinaryUrl,
        cloudinary_public_id: publicId,
        file_size_bytes: fileSizeBytes,
      })

    if (insertError) {
      console.error('Failed to save cache:', insertError)
      // Don't fail the request - just return the URL
    } else {
      console.log(`💾 Saved to cache: ${fileName}`)
    }

    return NextResponse.json({
      url: cloudinaryUrl,
      cached: false,
      fileName: fileName,
    })

  } catch (error) {
    console.error('Error in get-cached-url:', error)
    return NextResponse.json(
      { error: 'Failed to get cached URL', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
