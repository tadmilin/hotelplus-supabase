'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { User } from '@supabase/supabase-js'
import { FolderTree, type TreeFolder } from '@/components/FolderTree'
import imageCompression from 'browser-image-compression'

interface DriveImage {
  id: string
  name: string
  thumbnailUrl: string
  url: string
}

export default function GptImagePage() {
  const router = useRouter()
  const supabase = createClient()
  
  const [user, setUser] = useState<User | null>(null)
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [numImages, setNumImages] = useState(1)
  const [quality, setQuality] = useState('auto')
  const [outputFormat, setOutputFormat] = useState('webp')
  const [background, setBackground] = useState('auto')
  const [moderation, setModeration] = useState('auto')
  const [inputFidelity, setInputFidelity] = useState('low')
  const [outputCompression, setOutputCompression] = useState(90)
  const [inputImages, setInputImages] = useState<File[]>([])
  const [creating, setCreating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  
  // Drive management
  const [driveFolders, setDriveFolders] = useState<Array<{ driveId: string; driveName: string; folders: TreeFolder[] }>>([])
  const [selectedFolderId, setSelectedFolderId] = useState('')
  const [driveImages, setDriveImages] = useState<DriveImage[]>([])
  const [selectedDriveImages, setSelectedDriveImages] = useState<DriveImage[]>([])
  const [imageCounts, setImageCounts] = useState<Record<string, number>>({})
  const [loadingImages, setLoadingImages] = useState(false)
  const [loadingTimer, setLoadingTimer] = useState(0)
  const [isLoadingFolders, setIsLoadingFolders] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [availableDrives, setAvailableDrives] = useState<Array<{ driveId: string; driveName: string }>>([])
  const [showDriveSelector, setShowDriveSelector] = useState(false)
  const [selectedDriveIds, setSelectedDriveIds] = useState<Set<string>>(new Set())
  const [savingDrives, setSavingDrives] = useState(false)
  const [excludedFolderIds, setExcludedFolderIds] = useState<Set<string>>(new Set())

  // Template Mode (GPT → Nano Banana Pro Pipeline)
  const [useTemplate, setUseTemplate] = useState(false)
  const [templateFile, setTemplateFile] = useState<File | null>(null)
  const [templatePreview, setTemplatePreview] = useState<string | null>(null)

  useEffect(() => {
    async function checkAuth() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      setUser(user)
      await loadAvailableDrives()
      await loadExcludedFolders()
      
      // ✅ ไม่ auto-sync อีกต่อไป - ให้ user เลือก drives เอง
      // หรือกดปุ่ม Sync เอง (เพื่อให้การลบ drives มีประโยชน์)
      
      await fetchDriveFolders()
    }
    checkAuth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadAvailableDrives() {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/google_drives?select=drive_id,drive_name&order=drive_name`, {
        headers: {
          'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        }
      })
      if (res.ok) {
        const drives = await res.json()
        setAvailableDrives(drives)
      }
    } catch {
      console.error('Error loading available drives')
    }
  }

  async function syncDrives() {
    setSyncing(true)
    try {
      const res = await fetch('/api/drive/sync', { method: 'POST' })
      if (res.ok) {
        alert('✅ Sync สำเร็จ! กำลังโหลดใหม่...')
        await loadAvailableDrives()
      } else {
        const data = await res.json()
        alert(`❌ Sync ล้มเหลว: ${data.error}`)
      }
    } catch {
      alert('❌ เกิดข้อผิดพลาด')
    } finally {
      setSyncing(false)
    }
  }

  async function saveDriveSelection() {
    if (selectedDriveIds.size === 0) {
      alert('กรุณาเลือกอย่างน้อย 1 Drive')
      return
    }

    setSavingDrives(true)
    try {
      const res = await fetch('/api/drive/user-drives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driveIds: Array.from(selectedDriveIds) }),
      })

      if (res.ok) {
        alert('✅ บันทึกสำเร็จ! กำลังโหลดใหม่...')
        setShowDriveSelector(false)
        await fetchDriveFolders()
      } else {
        alert('❌ บันทึกไม่สำเร็จ')
      }
    } catch {
      alert('❌ เกิดข้อผิดพลาด')
    } finally {
      setSavingDrives(false)
    }
  }

  async function deleteDriveFolder(driveId: string, driveName: string) {
    const confirmed = confirm(
      `⚠️ ลบ Drive "${driveName}" ออกจากระบบ?\n\n` +
      `✅ จะลบ: Record ในฐานข้อมูล (เพื่อให้โหลดเร็วขึ้น)\n` +
      `❌ จะไม่ลบ: ไฟล์จริงใน Google Drive (ยังคงอยู่)\n\n` +
      `คุณสามารถ Sync กลับมาได้ทีหลัง`
    )

    if (!confirmed) return

    try {
      const res = await fetch('/api/drive/user-drives', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driveId }),
      })

      if (res.ok) {
        alert('✅ ลบสำเร็จ! ไฟล์จริงใน Drive ยังคงอยู่')
        await fetchDriveFolders()
      } else {
        alert('❌ ลบไม่สำเร็จ')
      }
    } catch {
      alert('❌ เกิดข้อผิดพลาด')
    }
  }

  async function loadExcludedFolders() {
    try {
      const res = await fetch('/api/drive/excluded-folders')
      if (res.ok) {
        const data: { folders: Array<{ folder_id: string }> } = await res.json()
        const ids = new Set<string>(data.folders.map(f => f.folder_id))
        setExcludedFolderIds(ids)
      }
    } catch (error) {
      console.error('Error loading excluded folders:', error)
    }
  }

  async function excludeFolder(folderId: string, folderName: string, driveId: string) {
    const confirmed = confirm(
      `⚠️ ซ่อนโฟลเดอร์ "${folderName}"?\n\n` +
      `✅ จะซ่อน: โฟลเดอร์นี้จะไม่แสดงอีก (โหลดเร็วขึ้น)\n` +
      `❌ จะไม่ลบ: ไฟล์จริงใน Drive ยังคงอยู่\n\n` +
      `คุณสามารถแสดงกลับมาได้จากการตั้งค่า`
    )

    if (!confirmed) return

    try {
      const res = await fetch('/api/drive/excluded-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId, folderName, driveId }),
      })

      if (res.ok) {
        alert('✅ ซ่อนโฟลเดอร์สำเร็จ! กำลังโหลดใหม่...')
        await loadExcludedFolders()
        await fetchDriveFolders()
      } else {
        alert('❌ ไม่สามารถซ่อนโฟลเดอร์ได้')
      }
    } catch {
      alert('❌ เกิดข้อผิดพลาด')
    }
  }

  function filterExcludedFolders(folders: TreeFolder[]): TreeFolder[] {
    return folders
      .filter(folder => !excludedFolderIds.has(folder.id))
      .map(folder => ({
        ...folder,
        children: folder.children ? filterExcludedFolders(folder.children) : []
      }))
  }

  async function fetchDriveFolders() {
    setIsLoadingFolders(true)
    setLoadingTimer(0)
    
    const timerInterval = setInterval(() => {
      setLoadingTimer(prev => prev + 0.1)
    }, 100)
    
    try {
      const res = await fetch('/api/drive/list-folders')
      if (res.ok) {
        const data = await res.json()
        // กรองโฟลเดอร์ที่ถูก exclude ออก
        const filteredDrives = (data.drives || []).map((drive: { driveId: string; driveName: string; folders: TreeFolder[] }) => ({
          ...drive,
          folders: filterExcludedFolders(drive.folders)
        }))
        setDriveFolders(filteredDrives)
        await countImagesInFolders(filteredDrives)
      }
    } catch (error) {
      console.error('Error fetching Drive folders:', error)
    } finally {
      clearInterval(timerInterval)
      setIsLoadingFolders(false)
    }
  }

  async function countImagesInFolders(drives: Array<{ driveId: string; driveName: string; folders: TreeFolder[] }>) {
    const folderIds: string[] = []
    
    function collectFolderIds(folders: TreeFolder[]) {
      for (const folder of folders) {
        folderIds.push(folder.id)
        if (folder.children && folder.children.length > 0) {
          collectFolderIds(folder.children)
        }
      }
    }
    
    drives.forEach(drive => collectFolderIds(drive.folders))
    
    if (folderIds.length === 0) return
    
    try {
      const res = await fetch('/api/drive/count-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderIds }),
      })
      
      if (res.ok) {
        const data = await res.json()
        setImageCounts(data.counts || {})
      }
    } catch (error) {
      console.error('Error counting images:', error)
    }
  }

  async function loadDriveImages() {
    if (!selectedFolderId) {
      alert('กรุณาเลือกโฟลเดอร์ก่อน')
      return
    }

    setLoadingImages(true)

    try {
      const res = await fetch('/api/drive/list-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: selectedFolderId }),
      })

      if (res.ok) {
        const data = await res.json()
        setDriveImages(data.images || [])
      } else {
        alert('Failed to load images')
      }
    } catch (error) {
      console.error('Error fetching images:', error)
      alert('Error loading images')
    } finally {
      setLoadingImages(false)
    }
  }

  function toggleDriveImage(image: DriveImage) {
    setSelectedDriveImages(prev => {
      const exists = prev.find(img => img.id === image.id)
      if (exists) {
        return prev.filter(img => img.id !== image.id)
      } else {
        return [...prev, image]
      }
    })
  }

  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (files && files.length > 0) {
      setUploading(true)
      
      const compressedFiles: File[] = []
      
      for (const file of Array.from(files)) {
        const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2)
        
        // Compress if file is larger than 3MB to ensure it stays under Vercel's 4.5MB limit
        if (file.size > 3 * 1024 * 1024) {
          console.log(`🔄 Compressing: ${file.name} (${fileSizeMB}MB)`)
          
          try {
            const options = {
              maxSizeMB: 3,
              maxWidthOrHeight: 2048,
              useWebWorker: true,
              fileType: 'image/jpeg' as const,
            }
            
            const compressed = await imageCompression(file, options)
            const compressedSizeMB = (compressed.size / (1024 * 1024)).toFixed(2)
            console.log(`✅ Compressed: ${fileSizeMB}MB → ${compressedSizeMB}MB`)
            
            compressedFiles.push(compressed)
          } catch (err) {
            console.error(`Failed to compress ${file.name}:`, err)
            compressedFiles.push(file) // Use original if compression fails
          }
        } else {
          console.log(`✓ ${file.name} (${fileSizeMB}MB) - no compression needed`)
          compressedFiles.push(file)
        }
      }
      
      setInputImages(compressedFiles)
      setUploading(false)
    }
  }

  async function handleCreate() {
    if (!prompt.trim()) {
      setError('กรุณากรอก Prompt')
      return
    }

    if (!user) {
      setError('กรุณาล็อกอินก่อนใช้งาน')
      return
    }

    setCreating(true)
    setError('')

    try {
      // Combine local uploads and Drive images
      let imageUrls: string[] = []
      
      // Upload input images if any
      if (inputImages.length > 0) {
        setUploading(true)
        
        // Calculate total size
        const totalSize = inputImages.reduce((sum, file) => sum + file.size, 0)
        const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2)
        
        console.log(`Uploading ${inputImages.length} files, total size: ${totalSizeMB}MB`)
        
        const formData = new FormData()
        inputImages.forEach((file) => {
          formData.append('files', file)
        })

        const uploadResponse = await fetch('/api/upload-images', {
          method: 'POST',
          body: formData,
        })

        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text()
          console.error('Upload failed:', uploadResponse.status, errorText)
          if (uploadResponse.status === 413) {
            throw new Error(`ไฟล์ใหญ่เกินไป (${totalSizeMB}MB) - กรุณาลดขนาดไฟล์หรือเลือกรูปน้อยลง`)
          }
          throw new Error('Failed to upload images')
        }

        const uploadData = await uploadResponse.json()
        imageUrls = uploadData.images?.map((img: { url: string }) => img.url) || []
        setUploading(false)
      }
      
      // Add Drive images
      if (selectedDriveImages.length > 0) {
        setUploading(true)
        console.log(`Converting ${selectedDriveImages.length} Drive images to Cloudinary URLs...`)
        
        // Convert Drive URLs to Cloudinary URLs (one by one)
        const cloudinaryUrls: string[] = []
        for (const driveImg of selectedDriveImages) {
          try {
            const response = await fetch('/api/drive/download-and-upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fileId: driveImg.id,
                fileName: driveImg.name,
              }),
            })

            if (!response.ok) {
              console.error(`Failed to convert Drive image: ${driveImg.name}`)
              continue
            }

            const data = await response.json()
            cloudinaryUrls.push(data.url)
            console.log(`✓ Converted: ${driveImg.name}`)
          } catch (err) {
            console.error(`Error converting ${driveImg.name}:`, err)
          }
        }
        
        imageUrls = [...imageUrls, ...cloudinaryUrls]
        setUploading(false)
        console.log(`✅ Converted ${cloudinaryUrls.length}/${selectedDriveImages.length} Drive images`)
      }

      // Create job in database
      const jobType = useTemplate ? 'gpt-with-template' : 'gpt-image'
      const jobData: Record<string, unknown> = {
        user_id: user.id,
        user_name: user.user_metadata?.name || null,
        user_email: user.email,
        job_type: jobType,
        status: 'processing',
        prompt: prompt,
        aspect_ratio: aspectRatio,
        quality: quality,
        output_format: outputFormat,
        background: background,
        moderation: moderation,
        input_fidelity: inputFidelity,
        output_compression: outputCompression,
        number_of_images: numImages,
        image_urls: imageUrls,
        output_urls: [],
      }

      // ✅ CRITICAL: INSERT to DB FIRST (before any external API calls)
      // This ensures job is tracked even if template upload or Replicate API fails
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert(jobData)
        .select()
        .single()

      if (jobError) throw jobError

      // Upload template if template mode is enabled
      if (useTemplate && templateFile) {
        setUploading(true)
        console.log('📤 Uploading template file...')
        
        const formData = new FormData()
        formData.append('files', templateFile)

        try {
          const templateUpload = await fetch('/api/upload-images', {
            method: 'POST',
            body: formData,
          })

          if (!templateUpload.ok) {
            throw new Error('ไม่สามารถอัพโหลด Template ได้')
          }

          const templateData = await templateUpload.json()
          const templateUrl = templateData.images[0]?.url
          
          if (!templateUrl) {
            throw new Error('ไม่พบ URL ของ Template')
          }

          // Update job with template URL
          await supabase
            .from('jobs')
            .update({ template_url: templateUrl })
            .eq('id', job.id)

          jobData.template_url = templateUrl
          setUploading(false)
          console.log('✅ Template uploaded:', templateUrl)
        } catch (templateError) {
          // Mark job as failed if template upload fails
          await supabase
            .from('jobs')
            .update({ 
              status: 'failed',
              error: templateError instanceof Error ? templateError.message : 'Template upload failed'
            })
            .eq('id', job.id)
          throw templateError
        }
      }

      // Call appropriate API based on mode
      const apiEndpoint = useTemplate ? '/api/replicate/gpt-with-template' : '/api/replicate/gpt-image'
      
      const apiBody: Record<string, unknown> = {
        jobId: job.id,
        prompt: prompt,
        aspectRatio: aspectRatio,
        numberOfImages: numImages,
        quality: quality,
        outputFormat: outputFormat,
        background: background,
        moderation: moderation,
        inputFidelity: inputFidelity,
        outputCompression: outputCompression,
        inputImages: imageUrls,
      }

      // Add template URL for template mode
      if (useTemplate && jobData.template_url) {
        apiBody.templateUrl = jobData.template_url
      }

      // Call Replicate API
      try {
        const response = await fetch(apiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(apiBody),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to create images')
        }

        const result = await response.json()

        // Update job with replicate_id (for non-pipeline mode)
        if (!useTemplate && result.id) {
          await supabase
            .from('jobs')
            .update({ replicate_id: result.id })
            .eq('id', job.id)
        }

        // Redirect to dashboard
        router.push('/dashboard')
      } catch (apiError) {
        // Mark job as failed if Replicate API fails
        await supabase
          .from('jobs')
          .update({ 
            status: 'failed',
            error: apiError instanceof Error ? apiError.message : 'Replicate API failed'
          })
          .eq('id', job.id)
        throw apiError
      }
    } catch (err: unknown) {
      console.error('Error:', err)
      const errorMessage = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการสร้างรูป'
      setError(errorMessage)
    } finally {
      setCreating(false)
      setUploading(false)
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">⏳</div>
          <p className="text-xl text-gray-600">กำลังโหลด...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 py-8">
      <div className="container mx-auto px-4 max-w-4xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-4xl font-bold text-purple-900 mb-2">
                🎨 GPT Image 1.5
              </h1>
              <p className="text-gray-600">
                สร้างและแก้ไขรูปด้วย OpenAI GPT Image 1.5 - ควบคุมได้อย่างแม่นยำ พร้อมอัปสเกลอัตโนมัติ
              </p>
              {isLoadingFolders && (
                <div className="mt-3 flex items-center gap-2 text-blue-600 bg-blue-50 px-4 py-2 rounded-lg">
                  <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                  <span className="text-sm font-semibold">
                    กำลังโหลดข้อมูลจากไดร์ฟ... {loadingTimer.toFixed(1)}s
                  </span>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setShowDriveSelector(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-semibold transition-colors flex items-center gap-2 whitespace-nowrap text-sm"
              >
                <span>⚙️</span>
                <span>เลือก Drives</span>
              </button>
              <button
                onClick={async () => {
                  await syncDrives()
                  await fetchDriveFolders()
                }}
                disabled={syncing || isLoadingFolders}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-semibold transition-colors flex items-center gap-2 disabled:opacity-50 whitespace-nowrap text-sm"
              >
                <span>{syncing ? '⏳' : '🔄'}</span>
                <span>{syncing ? 'Syncing...' : 'อัพเดทรายการ'}</span>
              </button>
              <p className="text-xs text-gray-500 text-center">
                💡 กดเมื่อมีโฟลเดอร์ใหม่
              </p>
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="bg-white rounded-2xl shadow-xl p-8 space-y-6">
          {error && (
            <div className="bg-red-50 border-2 border-red-200 text-red-700 px-4 py-3 rounded-lg">
              ⚠️ {error}
            </div>
          )}

          {/* Prompt Input */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              💬 Prompt (คำสั่งสร้างรูป) *
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              placeholder='เช่น: A photorealistic scene of a modern hotel lobby with natural lighting, "Welcome to Paradise" text on the wall, 4K quality...'
              className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
              disabled={creating}
            />
            <p className="text-xs text-gray-500 mt-2">
              💡 เคล็ดลับ: ใช้เครื่องหมาย &quot;...&quot; สำหรับข้อความที่ต้องการให้แสดงในรูป ({prompt.length} ตัวอักษร)
            </p>
          </div>

          {/* Template Mode */}
          <div className="bg-gradient-to-r from-orange-50 to-pink-50 rounded-xl p-6 border-2 border-orange-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">🎨 โหมดเทมเพลต (ปรับปรุงคุณภาพ)</h3>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useTemplate}
                  onChange={(e) => {
                    setUseTemplate(e.target.checked)
                    if (!e.target.checked) {
                      setTemplateFile(null)
                      setTemplatePreview(null)
                    }
                  }}
                  className="w-5 h-5 text-orange-500 rounded focus:ring-2 focus:ring-orange-500"
                  disabled={creating}
                />
                <span className="text-sm font-semibold text-gray-700">เปิดใช้งาน</span>
              </label>
            </div>

            {useTemplate && (
              <>
                <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <p className="text-sm text-blue-700">
                        <strong>Pipeline 3 ขั้นตอน:</strong> GPT Image สร้างรูปคุณภาพสูง → ใส่เทมเพลต → อัพสเกล (เพิ่มความคมชัด)
                      </p>
                      <p className="text-xs text-blue-600 mt-1">
                        ⏱️ ใช้เวลานานขึ้น | 💰 ราคาสูงขึ้น 2-3 เท่า | ⭐ คุณภาพสูงสุด
                      </p>
                    </div>
                  </div>
                </div>

                {/* Template Upload */}
                <div className="bg-white rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">📤 อัพโหลดเทมเพลต (ตัวอย่างที่ต้องการ)</h4>
                  
                  {!templateFile ? (
                    <div>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={async (e) => {
                          const file = e.target.files?.[0]
                          if (!file) return

                          try {
                            // Client-side compression for large files
                            let fileToUpload = file
                            if (file.size > 3 * 1024 * 1024) {
                              console.log(`Compressing template: ${(file.size / (1024 * 1024)).toFixed(2)}MB`)
                              fileToUpload = await imageCompression(file, {
                                maxSizeMB: 3,
                                maxWidthOrHeight: 2048,
                                useWebWorker: true,
                              })
                              console.log(`✓ Compressed to: ${(fileToUpload.size / (1024 * 1024)).toFixed(2)}MB`)
                            }

                            setTemplateFile(fileToUpload)
                            
                            // Create preview
                            const reader = new FileReader()
                            reader.onloadend = () => {
                              setTemplatePreview(reader.result as string)
                            }
                            reader.readAsDataURL(fileToUpload)
                            setError('')
                          } catch (err) {
                            console.error('Template error:', err)
                            setError('ไม่สามารถโหลดเทมเพลตได้')
                          }
                          e.target.value = ''
                        }}
                        className="w-full border-2 border-dashed border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                        disabled={creating || uploading}
                      />
                      <p className="text-xs text-gray-500 mt-2">
                        รองรับ: JPG, PNG, WebP (ขนาดไม่เกิน 10MB)
                      </p>
                    </div>
                  ) : (
                    <div className="border-2 border-orange-300 rounded-lg p-4 bg-orange-50">
                      <div className="flex items-center justify-between mb-2">
                        <h5 className="text-sm font-semibold text-gray-700">✅ เทมเพลตที่เลือก:</h5>
                        <button
                          onClick={() => {
                            setTemplateFile(null)
                            setTemplatePreview(null)
                          }}
                          className="text-red-500 hover:text-red-700 font-semibold text-sm"
                          disabled={creating}
                        >
                          🗑️ ลบ
                        </button>
                      </div>
                      {templatePreview && (
                        <div className="flex items-center gap-3">
                          <img
                            src={templatePreview}
                            alt="Template preview"
                            className="w-24 h-24 object-cover rounded-lg border-2 border-orange-300"
                          />
                          <div>
                            <p className="text-sm font-medium text-gray-900">{templateFile.name}</p>
                            <p className="text-xs text-gray-500">
                              {(templateFile.size / (1024 * 1024)).toFixed(2)} MB
                            </p>
                            <p className="text-xs text-orange-600 mt-1">
                              ระบบจะใช้เทมเพลตนี้ในการจัด layout
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Google Drive Images */}
          {driveFolders.length > 0 && (
            <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-xl p-6 border-2 border-green-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900">📂 เลือกรูปจาก Google Drive</h3>
                <button
                  onClick={() => setShowDriveSelector(true)}
                  className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1 rounded-lg font-semibold transition-colors"
                  title="จัดการ Drives"
                >
                  ⚙️ จัดการ Drives
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Folder Tree */}
                <div>
                  <div className="bg-white rounded-lg p-4 max-h-96 overflow-y-auto">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">โฟลเดอร์:</h4>
                    {driveFolders.map((drive) => (
                      <div key={drive.driveId} className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <h5 className="text-xs font-semibold text-gray-600 flex items-center gap-2">
                            <span>📱</span>
                            <span>{drive.driveName}</span>
                          </h5>
                          <button
                            onClick={() => deleteDriveFolder(drive.driveId, drive.driveName)}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded transition-colors text-xs font-semibold"
                            title="ลบ Drive นี้ออกจากระบบ (ไม่ลบไฟล์จริง)"
                          >
                            🗑️
                          </button>
                        </div>
                        <FolderTree
                          folders={drive.folders}
                          onSelectFolder={setSelectedFolderId}
                          selectedFolderId={selectedFolderId}
                          imageCounts={imageCounts}
                          onDeleteFolder={(folderId, folderName) => excludeFolder(folderId, folderName, drive.driveId)}
                          driveId={drive.driveId}
                        />
                      </div>
                    ))}
                  </div>
                  {selectedFolderId && (
                    <button
                      onClick={loadDriveImages}
                      disabled={loadingImages}
                      className="w-full bg-purple-600 hover:bg-purple-700 text-white py-2 px-4 rounded-lg font-semibold mt-3 disabled:opacity-50"
                    >
                      {loadingImages ? '⏳ กำลังโหลด...' : '📥 โหลดรูปจากโฟลเดอร์นี้'}
                    </button>
                  )}
                </div>

                {/* Images Grid */}
                <div className="bg-white rounded-lg p-4 max-h-96 overflow-y-auto">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">
                    รูปในโฟลเดอร์ ({driveImages.length} รูป)
                  </h4>
                  {driveImages.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2">
                      {driveImages.map((img) => {
                        const isSelected = selectedDriveImages.some(selected => selected.id === img.id)
                        return (
                          <div
                            key={img.id}
                            onClick={() => toggleDriveImage(img)}
                            className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer transition-all ${
                              isSelected
                                ? 'ring-4 ring-green-500 scale-95'
                                : 'ring-2 ring-gray-200 hover:ring-gray-400'
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={img.thumbnailUrl}
                              alt={img.name}
                              className="w-full h-full object-cover"
                            />
                            {isSelected && (
                              <div className="absolute inset-0 bg-green-500/20 flex items-center justify-center">
                                <span className="text-2xl">✓</span>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="text-gray-400 text-center py-8">
                      เลือกโฟลเดอร์แล้วกดโหลด
                    </p>
                  )}
                </div>
              </div>

              {selectedDriveImages.length > 0 && (
                <div className="mt-4 p-4 bg-green-100 rounded-lg">
                  <p className="text-sm font-semibold text-green-800 mb-3">
                    ✅ เลือกแล้ว {selectedDriveImages.length} รูปจาก Drive
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selectedDriveImages.map((img) => (
                      <div key={img.id} className="relative group">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.thumbnailUrl}
                          alt={img.name}
                          className="w-20 h-20 object-cover rounded-lg border-2 border-green-500"
                        />
                        <button
                          onClick={() => {
                            setSelectedDriveImages(prev => prev.filter(item => item.id !== img.id))
                          }}
                          className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shadow-lg transition-all opacity-0 group-hover:opacity-100"
                          title="ลบรูปนี้"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Input Images (Optional) */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              🖼️ รูปต้นฉบับ (Optional)
            </label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageSelect}
              className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              disabled={creating}
            />
            <p className="text-xs text-gray-500 mt-2">
              📎 อัพโหลดรูปเพื่อใช้เป็น Reference หรือแก้ไขรูป (สามารถเลือกหลายรูปได้)
            </p>
            {inputImages.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {inputImages.map((file, index) => (
                  <div key={index} className="relative group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={URL.createObjectURL(file)}
                      alt={`Preview ${index + 1}`}
                      className="w-20 h-20 object-cover rounded-lg border-2 border-purple-300"
                    />
                    <button
                      onClick={() => {
                        setInputImages(prev => prev.filter((_, i) => i !== index))
                      }}
                      className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shadow-lg transition-all opacity-0 group-hover:opacity-100"
                      title="ลบรูปนี้"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Aspect Ratio */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              📐 อัตราส่วนภาพ (Aspect Ratio)
            </label>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
              className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              disabled={creating}
            >
              <option value="1:1">1:1 (Square - จัตุรัส)</option>
              <option value="3:2">3:2 (Landscape - แนวนอน)</option>
              <option value="2:3">2:3 (Portrait - แนวตั้ง)</option>
            </select>
          </div>

          {/* Number of Images */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              🔢 จำนวนรูป (1-10)
            </label>
            <input
              type="number"
              min="1"
              max="10"
              value={numImages}
              onChange={(e) => setNumImages(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
              className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              disabled={creating}
            />
          </div>

          {/* Quality */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              ⭐ คุณภาพ (Quality)
            </label>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              disabled={creating}
            >
              <option value="auto">Auto (แนะนำ - ปรับอัตโนมัติ)</option>
              <option value="low">Low (เร็ว - ราคาถูก)</option>
              <option value="medium">Medium (สมดุล)</option>
              <option value="high">High (คุณภาพสูงสุด)</option>
            </select>
            <p className="text-xs text-gray-500 mt-2">
              💰 ราคา: Low ~$0.013/รูป | Medium ~$0.05/รูป | High/Auto ~$0.136/รูป
            </p>
          </div>

          {/* Output Format */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              📦 รูปแบบไฟล์ (Output Format)
            </label>
            <select
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value)}
              className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              disabled={creating}
            >
              <option value="webp">WebP (แนะนำ - ไฟล์เล็ก คุณภาพดี)</option>
              <option value="png">PNG (คุณภาพสูง - ไฟล์ใหญ่)</option>
              <option value="jpg">JPG (ไฟล์กลาง)</option>
            </select>
          </div>

          {/* Background */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              🎭 พื้นหลัง (Background)
            </label>
            <select
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              disabled={creating}
            >
              <option value="auto">Auto (ปรับอัตโนมัติ)</option>
              <option value="opaque">Opaque (ทึบแสง)</option>
              <option value="transparent">Transparent (โปร่งใส)</option>
            </select>
          </div>

          {/* Input Fidelity */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              🎯 ความยึดติดกับรูปต้นฉบับ (Input Fidelity)
            </label>
            <select
              value={inputFidelity}
              onChange={(e) => setInputFidelity(e.target.value)}
              className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              disabled={creating}
            >
              <option value="low">Low (ยืดหยุ่น - ปรับเปลี่ยนได้มาก)</option>
              <option value="medium">Medium (สมดุล)</option>
              <option value="high">High (ยึดติดกับต้นฉบับมาก)</option>
            </select>
            <p className="text-xs text-gray-500 mt-2">
              💡 ใช้เมื่ออัพโหลดรูปต้นฉบับ - ควบคุมว่าจะรักษาสไตล์และใบหน้าเดิมมากแค่ไหน
            </p>
          </div>

          {/* Output Compression */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              🗜️ การบีบอัด (Output Compression): {outputCompression}%
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={outputCompression}
              onChange={(e) => setOutputCompression(parseInt(e.target.value))}
              className="w-full"
              disabled={creating}
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>ไฟล์เล็ก (0%)</span>
              <span>คุณภาพสูง (100%)</span>
            </div>
          </div>

          {/* Moderation */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              🛡️ ระดับการกลั่นกรองเนื้อหา (Moderation)
            </label>
            <select
              value={moderation}
              onChange={(e) => setModeration(e.target.value)}
              className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              disabled={creating}
            >
              <option value="auto">Auto (แนะนำ)</option>
              <option value="strict">Strict (เข้มงวด)</option>
              <option value="relaxed">Relaxed (ผ่อนปรน)</option>
            </select>
          </div>

          {/* Submit Button */}
          <div className="pt-4">
            <button
              onClick={handleCreate}
              disabled={creating || !prompt.trim()}
              className={`w-full py-4 px-6 rounded-lg font-bold text-lg transition-all ${
                creating || !prompt.trim()
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700 shadow-lg hover:shadow-xl'
              }`}
            >
              {uploading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin">⏳</span>
                  กำลังอัพโหลดรูป...
                </span>
              ) : creating ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin">⏳</span>
                  กำลังสร้างรูป... (จะอัปสเกลอัตโนมัติ)
                </span>
              ) : (
                '🚀 สร้างรูปพร้อมอัปสเกล'
              )}
            </button>
          </div>

          {/* Info */}
          <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold text-blue-900 mb-2">ℹ️ ข้อมูลเพิ่มเติม</h3>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• ระบบจะสร้างรูปและอัปสเกลอัตโนมัติด้วย Real-ESRGAN (4x)</li>
              <li>• สามารถใช้รูปต้นฉบับเพื่อแก้ไข, ใส่สไตล์, หรือผสมผสานได้</li>
              <li>• รองรับการเขียนข้อความในรูป - ใส่คำในเครื่องหมาย &quot;...&quot;</li>
              <li>• ผลลัพธ์จะปรากฏใน Dashboard หลังจากสร้างเสร็จ</li>
              <li>• Quality Auto จะปรับตามความซับซ้อนของ Prompt อัตโนมัติ</li>
            </ul>
          </div>
        </div>

        {/* Drive Selector Modal */}
        {showDriveSelector && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6">
              <h2 className="text-2xl font-bold text-purple-900 mb-4">
                เลือก Drives ที่ต้องการใช้งาน
              </h2>
              <p className="text-gray-600 mb-6">
                เลือก Drives ที่คุณต้องการเห็น - จะโหลดเร็วขึ้นมาก! 🚀
              </p>

              {availableDrives.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 mb-4">ไม่มี Drives ในระบบ</p>
                  <button
                    onClick={syncDrives}
                    disabled={syncing}
                    className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-semibold"
                  >
                    {syncing ? '⏳ กำลัง Sync...' : '🔄 Sync Drives จาก Google'}
                  </button>
                </div>
              ) : (
                <>
                  <div className="space-y-3 mb-6 max-h-96 overflow-y-auto">
                    {availableDrives.map(drive => (
                      <label
                        key={drive.driveId}
                        className="flex items-center gap-3 p-4 bg-gray-50 hover:bg-gray-100 rounded-lg cursor-pointer border-2 border-transparent hover:border-indigo-200 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedDriveIds.has(drive.driveId)}
                          onChange={(e) => {
                            const newSet = new Set(selectedDriveIds)
                            if (e.target.checked) {
                              newSet.add(drive.driveId)
                            } else {
                              newSet.delete(drive.driveId)
                            }
                            setSelectedDriveIds(newSet)
                          }}
                          className="w-5 h-5 text-indigo-600 rounded"
                        />
                        <span className="font-semibold text-gray-800">{drive.driveName}</span>
                      </label>
                    ))}
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={saveDriveSelection}
                      disabled={savingDrives || selectedDriveIds.size === 0}
                      className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-lg font-semibold transition-colors disabled:opacity-50"
                    >
                      {savingDrives ? '⏳ กำลังบันทึก...' : `💾 บันทึก (${selectedDriveIds.size})`}
                    </button>
                    <button
                      onClick={() => setShowDriveSelector(false)}
                      className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 py-3 rounded-lg font-semibold transition-colors"
                    >
                      ยกเลิก
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
