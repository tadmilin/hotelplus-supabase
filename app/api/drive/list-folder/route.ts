import { NextRequest, NextResponse } from 'next/server'
import { getDriveClient } from '@/lib/google-drive'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const { folderId } = await req.json()

    if (!folderId) {
      return NextResponse.json({ error: 'Folder ID required' }, { status: 400 })
    }

    // 🚀 Check cache first
    const supabase = await createClient()
    const { data: cached } = await supabase
      .from('folder_cache')
      .select('*')
      .eq('folder_id', folderId)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (cached) {
      // Cache HIT - update access stats
      await supabase
        .from('folder_cache')
        .update({
          last_accessed_at: new Date().toISOString(),
          access_count: (cached.access_count || 0) + 1
        })
        .eq('folder_id', folderId)

      console.log('✅ Cache HIT:', folderId, cached.images.length, 'images')
      return NextResponse.json({ 
        images: cached.images,
        cached: true,
        total: cached.images.length
      })
    }

    // Cache MISS - fetch from Drive
    console.log('⚠️ Cache MISS:', folderId)
    const drive = getDriveClient()

    if (!drive) {
       return NextResponse.json({ error: 'Google Drive not configured' }, { status: 503 })
    }

    // 🚀 Pagination loop - ดึงให้ครบทุกหน้า
    const allImages: Array<{ id: string; name: string; thumbnailUrl: string; url: string }> = []
    let nextPageToken: string | undefined = undefined
    let pageCount = 0

    do {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await drive.files.list({
        q: `'${folderId}' in parents and (mimeType contains 'image/') and trashed=false`,
        fields: 'files(id, name, mimeType, thumbnailLink, webContentLink), nextPageToken',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        pageSize: 1000, // 🚀 MAX ของ Drive API (1000 รูป/ครั้ง)
        pageToken: nextPageToken,
        orderBy: 'createdTime desc',
      })

      const files = response.data.files || []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const images = files.map((file: any) => {
        // 🚀 สูตรโกง: เปลี่ยน thumbnail เป็น s1600 (high-res แต่โหลดเร็ว)
        let fastUrl = file.thumbnailLink || ''
        if (fastUrl) {
          fastUrl = fastUrl.replace(/=s\d+$/, '') + '=s1600'
        }

        return {
          id: file.id!,
          name: file.name!,
          thumbnailUrl: fastUrl,
          url: file.webContentLink || '',
        }
      })

      allImages.push(...images)
      nextPageToken = response.data.nextPageToken || undefined
      pageCount++

      console.log(`📄 Page ${pageCount}: ${images.length} images, total: ${allImages.length}`)
    } while (nextPageToken) // ⚡ Loop จนกว่าจะหมด

    // 💾 Save to cache
    await supabase
      .from('folder_cache')
      .upsert({
        folder_id: folderId,
        images: allImages,
        image_count: allImages.length,
        cached_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
        last_accessed_at: new Date().toISOString(),
        access_count: 1
      }, { onConflict: 'folder_id' })

    console.log(`💾 Cached: ${folderId}, ${allImages.length} images (${pageCount} pages)`)

    return NextResponse.json({ 
      images: allImages,
      cached: false,
      total: allImages.length
    })
  } catch (error) {
    console.error('Error listing folder:', error)
    return NextResponse.json(
      { error: 'Failed to list folder contents' },
      { status: 500 }
    )
  }
}
