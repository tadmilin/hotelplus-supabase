'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { FolderTree, type TreeFolder } from '@/components/FolderTree'
import { User } from '@supabase/supabase-js'
import imageCompression from 'browser-image-compression'

interface DriveImage {
  id: string
  name: string
  thumbnailUrl: string
  url: string
}

type SeedreamAspectRatio = 'square_1_1' | 'widescreen_16_9' | 'social_story_9_16' | 'portrait_2_3' | 'traditional_3_4' | 'standard_3_2' | 'classic_4_3' | 'cinematic_21_9'

export default function FreepikPage() {
  const router = useRouter()
  const supabase = createClient()
  
  const [user, setUser] = useState<User | null>(null)
  const [driveFolders, setDriveFolders] = useState<Array<{ driveId: string; driveName: string; folders: TreeFolder[] }>>([])
  const [selectedFolderId, setSelectedFolderId] = useState('')
  const [driveImages, setDriveImages] = useState<DriveImage[]>([])
  const [displayedImages, setDisplayedImages] = useState<DriveImage[]>([])
  const [selectedImagesMap, setSelectedImagesMap] = useState<Map<string, DriveImage>>(new Map())
  const [imageCounts, setImageCounts] = useState<Record<string, number>>({})
  const [customPrompt, setCustomPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState<SeedreamAspectRatio>('square_1_1')
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [excludedFolderIds, setExcludedFolderIds] = useState<Set<string>>(new Set())
  
  // Drive management
  const [showDriveSelector, setShowDriveSelector] = useState(false)
  const [availableDrives, setAvailableDrives] = useState<Array<{ driveId: string; driveName: string }>>([])
  const [selectedDriveIds, setSelectedDriveIds] = useState<Set<string>>(new Set())
  const [savingDrives, setSavingDrives] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [loadingTimer, setLoadingTimer] = useState(0)
  const [isLoadingFolders, setIsLoadingFolders] = useState(false)
  
  // Template state (optional - for Image to Prompt)
  const [enableTemplate, setEnableTemplate] = useState(false)
  const [templateFolderId, setTemplateFolderId] = useState('')
  const [templateImages, setTemplateImages] = useState<DriveImage[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [templateSearch, setTemplateSearch] = useState('')
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [uploadingTemplate, setUploadingTemplate] = useState(false)
  
  // Improve Prompt toggle
  const [enableImprovePrompt, setEnableImprovePrompt] = useState(true)
  
  // Search state
  const [folderSearch, setFolderSearch] = useState('')

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

  async function loadExcludedFolders() {
    try {
      const res = await fetch('/api/drive/excluded-folders')
      if (res.ok) {
        const data = await res.json()
        const ids: Set<string> = new Set(data.folders.map((f: { folder_id: string }) => f.folder_id))
        setExcludedFolderIds(ids)
      }
    } catch (error) {
      console.error('Error loading excluded folders:', error)
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

  function filterFoldersBySearch(folders: TreeFolder[], searchTerm: string): TreeFolder[] {
    if (!searchTerm) return folders
    
    const searchLower = searchTerm.toLowerCase()
    const filtered: TreeFolder[] = []
    
    for (const folder of folders) {
      const nameMatch = folder.name.toLowerCase().includes(searchLower)
      
      if (nameMatch) {
        filtered.push(folder)
      } else {
        const filteredChildren = folder.children ? filterFoldersBySearch(folder.children, searchTerm) : []
        if (filteredChildren.length > 0) {
          filtered.push({
            ...folder,
            children: filteredChildren
          })
        }
      }
    }
    
    return filtered
  }

  async function fetchDriveFolders() {
    setIsLoadingFolders(true)
    setLoadingTimer(0)
    
    const timerInterval = setInterval(() => {
      setLoadingTimer(prev => prev + 0.1)
    }, 100)
    
    try {
      await loadExcludedFolders()
      
      const cacheKey = 'drive_folders_cache'
      const cached = localStorage.getItem(cacheKey)
      
      if (cached) {
        try {
          const { data, timestamp } = JSON.parse(cached)
          const ageInMinutes = (Date.now() - timestamp) / (1000 * 60)
          
          if (ageInMinutes < 60) {
            const filteredDrives = data.map((drive: { driveId: string; driveName: string; folders: TreeFolder[] }) => ({
              ...drive,
              folders: filterExcludedFolders(drive.folders)
            }))
            setDriveFolders(filteredDrives)
            setStatus(`✅ โหลดจาก cache (${data.length} drives)`)
            setTimeout(() => setStatus(''), 3000)
            return
          }
        } catch {
          console.log('Cache parse error')
        }
      }
      
      setStatus('🔄 กำลังโหลดโฟลเดอร์จาก Google Drive...')
      
      const res = await fetch('/api/drive/list-folders')
      if (res.ok) {
        const data = await res.json()
        
        localStorage.setItem(cacheKey, JSON.stringify({
          data: data.drives || [],
          timestamp: Date.now()
        }))
        
        const filteredDrives = (data.drives || []).map((drive: { driveId: string; driveName: string; folders: TreeFolder[] }) => ({
          ...drive,
          folders: filterExcludedFolders(drive.folders)
        }))
        setDriveFolders(filteredDrives)
        setStatus(`✅ โหลด ${data.drives?.length || 0} drives สำเร็จ`)
        setTimeout(() => setStatus(''), 3000)
      }
    } catch (error) {
      console.error('Error fetching Drive folders:', error)
      setStatus('❌ โหลดล้มเหลว')
    } finally {
      clearInterval(timerInterval)
      setIsLoadingFolders(false)
    }
  }

  async function loadDriveImages() {
    if (!selectedFolderId) {
      alert('กรุณาเลือกโฟลเดอร์ก่อน')
      return
    }

    setLoading(true)
    setStatus('🔄 กำลังโหลดรูปจาก Google Drive...')

    try {
      const res = await fetch('/api/drive/list-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: selectedFolderId }),
      })

      if (res.ok) {
        const data = await res.json()
        setDriveImages(data.images || [])
        setDisplayedImages((data.images || []).slice(0, 100))
        
        setImageCounts(prev => ({
          ...prev,
          [selectedFolderId]: data.images.length
        }))
        
        setStatus(`✅ โหลด ${data.images.length} รูป${data.cached ? ' (จาก cache)' : ''}`)
        setTimeout(() => setStatus(''), 3000)
      } else {
        alert('Failed to load images')
        setStatus('')
      }
    } catch (error) {
      console.error('Error fetching images:', error)
      alert('Error loading images')
      setStatus('')
    } finally {
      setLoading(false)
    }
  }

  async function handleFileUpload(files: FileList | null) {
    if (!files || files.length === 0) return

    setUploadingFiles(true)
    const uploadedImages: DriveImage[] = []

    try {
      const VERCEL_LIMIT_MB = 4
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2)
        setStatus(`📤 กำลังอัพโหลด ${i + 1}/${files.length}: ${file.name} (${fileSizeMB}MB)...`)

        let fileToUpload: File | Blob = file
        const isHEIC = file.type === 'image/heic' || file.type === 'image/heif' || 
                       file.name.toLowerCase().endsWith('.heic') || 
                       file.name.toLowerCase().endsWith('.heif')
        
        if (file.size > VERCEL_LIMIT_MB * 1024 * 1024) {
          setStatus(`🗜️ กำลังบีบอัด ${file.name} (${fileSizeMB}MB → <4MB)...`)
          
          try {
            const options = {
              maxSizeMB: VERCEL_LIMIT_MB,
              maxWidthOrHeight: 3840,
              useWebWorker: true,
              fileType: 'image/jpeg' as const,
              initialQuality: 0.9,
            }
            fileToUpload = await imageCompression(file, options)
          } catch {
            try {
              const fallbackOptions = {
                maxSizeMB: VERCEL_LIMIT_MB,
                maxWidthOrHeight: 2560,
                useWebWorker: true,
                fileType: 'image/jpeg' as const,
                initialQuality: 0.7,
              }
              fileToUpload = await imageCompression(file, fallbackOptions)
            } catch {
              alert(`❌ ไม่สามารถบีบอัด ${file.name} ได้`)
              continue
            }
          }
        } else if (isHEIC) {
          setStatus(`📱 กำลังแปลงไฟล์ iPhone ${file.name}...`)
          try {
            const options = {
              maxSizeMB: VERCEL_LIMIT_MB,
              maxWidthOrHeight: 3840,
              useWebWorker: true,
              fileType: 'image/jpeg' as const,
            }
            fileToUpload = await imageCompression(file, options)
          } catch {
            // ส่งไป server ให้ handle
          }
        }

        const formData = new FormData()
        formData.append('files', fileToUpload)

        const res = await fetch('/api/upload-images', {
          method: 'POST',
          body: formData,
        })

        if (res.ok) {
          const data = await res.json()
          uploadedImages.push(...data.images)
        } else {
          console.error(`Failed to upload ${file.name}`)
          alert(`ไม่สามารถอัพโหลด ${file.name} ได้`)
        }
      }

      if (uploadedImages.length > 0) {
        setSelectedImagesMap(prev => {
          const newMap = new Map(prev)
          uploadedImages.forEach(img => {
            newMap.set(img.id, img)
          })
          return newMap
        })

        setStatus(`✅ อัพโหลดสำเร็จ ${uploadedImages.length} รูป`)
        setTimeout(() => setStatus(''), 3000)
      }
    } catch (error) {
      console.error('Upload error:', error)
      alert('เกิดข้อผิดพลาดในการอัพโหลด')
      setStatus('')
    } finally {
      setUploadingFiles(false)
    }
  }

  function toggleImageSelection(image: DriveImage) {
    setSelectedImagesMap(prev => {
      const newMap = new Map(prev)
      if (newMap.has(image.id)) {
        newMap.delete(image.id)
      } else {
        // Seedream limit: 5 images max
        if (newMap.size >= 5) {
          alert('⚠️ Seedream รองรับสูงสุด 5 รูป')
          return prev
        }
        newMap.set(image.id, image)
      }
      return newMap
    })
  }

  async function loadTemplateImages() {
    if (!templateFolderId) {
      alert('กรุณาเลือกโฟลเดอร์ Template ก่อน')
      return
    }

    setLoadingTemplates(true)
    try {
      const res = await fetch('/api/drive/list-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: templateFolderId }),
      })

      if (res.ok) {
        const data = await res.json()
        setTemplateImages(data.images || [])
      } else {
        alert('ไม่สามารถโหลด Template ได้')
      }
    } catch (error) {
      console.error('Load template error:', error)
      alert('เกิดข้อผิดพลาดในการโหลด Template')
    } finally {
      setLoadingTemplates(false)
    }
  }

  async function handleTemplateUpload(files: FileList | null) {
    if (!files || files.length === 0) return

    setUploadingTemplate(true)
    setStatus('📤 กำลังอัพโหลดรูป Template...')

    try {
      const VERCEL_LIMIT_MB = 4
      const file = files[0]
      let fileToUpload: File | Blob = file
      
      if (file.size > VERCEL_LIMIT_MB * 1024 * 1024) {
        setStatus(`🗜️ กำลังบีบอัด ${file.name}...`)
        try {
          const options = {
            maxSizeMB: VERCEL_LIMIT_MB,
            maxWidthOrHeight: 3840,
            useWebWorker: true,
            fileType: 'image/jpeg' as const,
            initialQuality: 0.9,
          }
          fileToUpload = await imageCompression(file, options)
        } catch {
          const fallbackOptions = {
            maxSizeMB: VERCEL_LIMIT_MB,
            maxWidthOrHeight: 2560,
            useWebWorker: true,
            fileType: 'image/jpeg' as const,
            initialQuality: 0.7,
          }
          fileToUpload = await imageCompression(file, fallbackOptions)
        }
      }

      const isHEIC = file.type === 'image/heic' || file.type === 'image/heif' || 
                     file.name.toLowerCase().endsWith('.heic') || 
                     file.name.toLowerCase().endsWith('.heif')
      
      if (isHEIC) {
        setStatus(`📱 กำลังแปลงไฟล์ iPhone...`)
        const options = {
          maxSizeMB: VERCEL_LIMIT_MB,
          maxWidthOrHeight: 3840,
          useWebWorker: true,
          fileType: 'image/jpeg' as const,
        }
        fileToUpload = await imageCompression(file, options)
      }

      const formData = new FormData()
      formData.append('files', fileToUpload)

      const res = await fetch('/api/upload-images', {
        method: 'POST',
        body: formData,
      })

      if (res.ok) {
        const data = await res.json()
        if (data.images && data.images.length > 0) {
          const uploadedImage = data.images[0]
          setTemplateImages(prev => [uploadedImage, ...prev])
          setSelectedTemplate(uploadedImage.url)
          setStatus(`✅ อัพโหลดสำเร็จ`)
          setTimeout(() => setStatus(''), 3000)
        }
      } else {
        throw new Error('Upload failed')
      }
    } catch (error) {
      console.error('Upload error:', error)
      alert('เกิดข้อผิดพลาดในการอัพโหลด')
      setStatus('')
    } finally {
      setUploadingTemplate(false)
    }
  }

  async function handleCreate() {
    if (selectedImagesMap.size === 0) {
      alert('กรุณาเลือกรูปที่ต้องการแก้ไขอย่างน้อย 1 รูป (สูงสุด 5 รูป)')
      return
    }

    if (!customPrompt.trim()) {
      alert('กรุณากรอก Prompt')
      return
    }

    if (enableTemplate && !selectedTemplate) {
      alert('กรุณาเลือก Template หรือปิด Template mode')
      return
    }

    setCreating(true)
    setStatus('กำลังเตรียมรูปภาพ...')

    try {
      const selectedImages = Array.from(selectedImagesMap.values())
      if (!user) throw new Error('User not authenticated')

      // Create job first
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert({
          user_id: user.id,
          user_name: user.user_metadata?.name || null,
          user_email: user.email,
          job_type: 'freepik-seedream',
          status: 'processing',
          prompt: customPrompt,
          output_size: aspectRatio,
          image_urls: selectedImages.map(img => img.url),
          template_url: enableTemplate ? selectedTemplate : null,
          output_urls: [],
        })
        .select()
        .single()

      if (jobError) throw jobError

      // Upload images to Cloudinary
      setStatus(`กำลังอัพโหลด ${selectedImages.length} รูป...`)
      
      const imageUrls: string[] = []
      const batchSize = 3
      
      for (let i = 0; i < selectedImages.length; i += batchSize) {
        const batch = selectedImages.slice(i, i + batchSize)
        
        const batchPromises = batch.map(async (img) => {
          if (img.url.includes('cloudinary.com')) {
            return img.url
          }
          
          if (img.url.includes('drive.google.com') || img.id.length > 20) {
            const uploadRes = await fetch('/api/drive/download-and-upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileId: img.id, fileName: img.name }),
            })
            
            if (!uploadRes.ok) throw new Error('Failed to upload image')
            const { url } = await uploadRes.json()
            return url
          }
          
          return img.url
        })
        
        setStatus(`อัพโหลด ${i + 1}-${Math.min(i + batchSize, selectedImages.length)}/${selectedImages.length}...`)
        const batchResults = await Promise.all(batchPromises)
        imageUrls.push(...batchResults)
      }

      // Upload template if enabled
      let finalTemplateUrl: string | null = null
      if (enableTemplate && selectedTemplate) {
        setStatus('กำลังอัพโหลด Template...')
        
        const templateImage = templateImages.find(img => img.url === selectedTemplate)
        
        if (templateImage) {
          const isCloudinaryUrl = selectedTemplate.includes('cloudinary.com')
          
          if (isCloudinaryUrl) {
            finalTemplateUrl = selectedTemplate
          } else {
            const uploadRes = await fetch('/api/drive/download-and-upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileId: templateImage.id, fileName: templateImage.name }),
            })
            
            if (uploadRes.ok) {
              const { url } = await uploadRes.json()
              finalTemplateUrl = url
            } else {
              throw new Error('Template upload failed')
            }
          }
        }
      }

      // Update job with Cloudinary URLs
      await supabase.from('jobs').update({
        image_urls: imageUrls,
        template_url: finalTemplateUrl,
      }).eq('id', job.id)

      // Call Freepik API
      setStatus('🎨 กำลังส่งไป Freepik AI...')
      
      const response = await fetch('/api/freepik/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.id,
          imageUrls: imageUrls,
          templateUrl: finalTemplateUrl,
          customPrompt: customPrompt,
          aspectRatio: aspectRatio,
          enableImprovePrompt: enableImprovePrompt,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Freepik API failed')
      }

      setStatus('✅ ส่งงานสำเร็จ! กำลังไปหน้า Dashboard...')
      
      setTimeout(() => {
        router.push('/dashboard')
      }, 1500)

    } catch (error) {
      console.error('Error:', error)
      const message = error instanceof Error ? error.message : 'เกิดข้อผิดพลาด'
      alert(`เกิดข้อผิดพลาด: ${message}`)
      setStatus('')
    } finally {
      setCreating(false)
    }
  }

  function loadMoreImages() {
    const currentLen = displayedImages.length
    const nextBatch = driveImages.slice(currentLen, currentLen + 100)
    setDisplayedImages(prev => [...prev, ...nextBatch])
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-teal-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">⏳</div>
          <p className="text-xl text-gray-600">กำลังโหลด...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-teal-50 py-8">
      <div className="container mx-auto px-4 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-4xl font-bold text-teal-900 mb-2">
                🎨 Freepik Seedream Edit
              </h1>
              <p className="text-gray-600">
                แก้ไขรูปด้วย Freepik Seedream 4.5 - เลือกรูปที่ต้องการแก้ไข (1-5 รูป) + เขียน Prompt
              </p>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className="bg-teal-100 text-teal-700 text-xs px-2 py-1 rounded-full font-semibold">
                  ✨ Improve Prompt
                </span>
                <span className="bg-teal-100 text-teal-700 text-xs px-2 py-1 rounded-full font-semibold">
                  🎨 Seedream 4.5 Edit
                </span>
                <span className="bg-teal-100 text-teal-700 text-xs px-2 py-1 rounded-full font-semibold">
                  📐 4MP Output
                </span>
              </div>
              {isLoadingFolders && (
                <div className="mt-3 flex items-center gap-2 text-teal-600 bg-teal-50 px-4 py-2 rounded-lg">
                  <div className="animate-spin h-5 w-5 border-2 border-teal-600 border-t-transparent rounded-full"></div>
                  <span className="text-sm font-semibold">
                    กำลังโหลดข้อมูลจากไดร์ฟ... {loadingTimer.toFixed(1)}s
                  </span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDriveSelector(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-semibold transition-colors flex items-center gap-2 whitespace-nowrap"
              >
                <span>⚙️</span>
                <span>เลือก Drives</span>
              </button>
              <div className="flex flex-col gap-1">
                <button
                  onClick={async () => {
                    localStorage.removeItem('drive_folders_cache')
                    try {
                      await fetch('/api/drive/list-folders', { method: 'DELETE' })
                    } catch {}
                    await syncDrives()
                    await fetchDriveFolders()
                  }}
                  disabled={syncing || isLoadingFolders}
                  className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-semibold transition-colors flex items-center gap-2 disabled:opacity-50 whitespace-nowrap"
                >
                  <span>{syncing ? '⏳' : '🔄'}</span>
                  <span>{syncing ? 'Syncing...' : 'อัพเดทรายการ'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Drive Selector Modal */}
        {showDriveSelector && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-gray-800">⚙️ เลือก Drives</h2>
                <button onClick={() => setShowDriveSelector(false)} className="text-gray-500 hover:text-gray-700">
                  ✕
                </button>
              </div>
              
              <div className="space-y-2 mb-4">
                {availableDrives.map((drive) => (
                  <label key={drive.driveId} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100">
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
                      className="w-5 h-5 text-teal-600 rounded"
                    />
                    <span className="text-gray-700">{drive.driveName}</span>
                  </label>
                ))}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={saveDriveSelection}
                  disabled={savingDrives}
                  className="flex-1 bg-teal-600 hover:bg-teal-700 text-white py-2 rounded-lg font-semibold disabled:opacity-50"
                >
                  {savingDrives ? '⏳ กำลังบันทึก...' : '✅ บันทึก'}
                </button>
                <button
                  onClick={() => setShowDriveSelector(false)}
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg font-semibold"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Status */}
        {status && (
          <div className="mb-6 bg-teal-50 border-2 border-teal-200 text-teal-700 px-4 py-3 rounded-lg text-center font-semibold">
            {status}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Template (Optional) */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-teal-900">
                  1️⃣ Template (ไม่บังคับ)
                </h2>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableTemplate}
                    onChange={(e) => setEnableTemplate(e.target.checked)}
                    className="w-5 h-5 text-teal-600 rounded"
                  />
                  <span className="text-sm font-semibold text-gray-600">เปิดใช้</span>
                </label>
              </div>

              {enableTemplate ? (
                <>
                  <p className="text-sm text-gray-500 mb-4">
                    AI จะดึง style จาก Template มาใช้ (Image to Prompt)
                  </p>
                  
                  {/* Upload Template */}
                  <div className="mb-4">
                    <label className="block w-full cursor-pointer">
                      <div className="border-2 border-dashed border-teal-300 rounded-lg p-4 text-center hover:border-teal-500 hover:bg-teal-50 transition-colors">
                        {uploadingTemplate ? (
                          <div className="flex items-center justify-center gap-2">
                            <div className="animate-spin h-5 w-5 border-2 border-teal-600 border-t-transparent rounded-full"></div>
                            <span className="text-teal-600">กำลังอัพโหลด...</span>
                          </div>
                        ) : (
                          <>
                            <span className="text-3xl">📤</span>
                            <p className="text-teal-600 font-semibold mt-2">อัพโหลด Template</p>
                          </>
                        )}
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleTemplateUpload(e.target.files)}
                        className="hidden"
                        disabled={uploadingTemplate}
                      />
                    </label>
                  </div>

                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex-1 h-px bg-gray-200"></div>
                    <span className="text-gray-400 text-sm">หรือเลือกจาก Drive</span>
                    <div className="flex-1 h-px bg-gray-200"></div>
                  </div>

                  {/* Template Search */}
                  <div className="mb-4">
                    <input
                      type="text"
                      value={templateSearch}
                      onChange={(e) => setTemplateSearch(e.target.value)}
                      placeholder="🔍 ค้นหาโฟลเดอร์..."
                      className="w-full px-4 py-2 border-2 border-teal-200 rounded-lg focus:border-teal-500 focus:outline-none text-black"
                    />
                  </div>

                  {/* Template Folder Tree */}
                  <div className="max-h-32 overflow-y-auto border-2 border-gray-100 rounded-lg p-2 mb-4">
                    {driveFolders.length === 0 ? (
                      <p className="text-gray-400 text-center py-2">ไม่มีโฟลเดอร์</p>
                    ) : (
                      driveFolders.map((drive) => {
                        const filteredFolders = filterFoldersBySearch(drive.folders, templateSearch)
                        if (templateSearch && filteredFolders.length === 0) return null
                        
                        return (
                          <div key={drive.driveId} className="mb-2">
                            <h3 className="text-xs font-semibold text-gray-500">
                              📱 {drive.driveName}
                            </h3>
                            <FolderTree
                              folders={filteredFolders}
                              onSelectFolder={(id) => {
                                setTemplateFolderId(id)
                                setSelectedTemplate('')
                                setTemplateImages([])
                              }}
                              selectedFolderId={templateFolderId}
                              imageCounts={{}}
                            />
                          </div>
                        )
                      })
                    )}
                  </div>

                  {templateFolderId && (
                    <button
                      onClick={loadTemplateImages}
                      disabled={loadingTemplates}
                      className="w-full bg-teal-600 hover:bg-teal-700 text-white py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 mb-4"
                    >
                      {loadingTemplates ? '⏳ กำลังโหลด...' : '📂 โหลด Templates'}
                    </button>
                  )}

                  {/* Template Grid */}
                  {templateImages.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto">
                      {templateImages.map((img) => (
                        <div
                          key={img.id}
                          onClick={() => setSelectedTemplate(selectedTemplate === img.url ? '' : img.url)}
                          className={`relative cursor-pointer rounded-lg overflow-hidden border-3 transition-all ${
                            selectedTemplate === img.url
                              ? 'border-teal-500 ring-2 ring-teal-300'
                              : 'border-transparent hover:border-teal-200'
                          }`}
                        >
                          <Image
                            src={img.thumbnailUrl || img.url}
                            alt={img.name}
                            width={100}
                            height={100}
                            className="w-full h-20 object-cover"
                          />
                          {selectedTemplate === img.url && (
                            <div className="absolute inset-0 bg-teal-500/30 flex items-center justify-center">
                              <span className="text-xl">✓</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedTemplate && (
                    <div className="mt-4 p-2 bg-teal-50 rounded-lg">
                      <p className="text-sm font-semibold text-teal-700">✅ Template เลือกแล้ว</p>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-400 text-center py-4">
                  ไม่ใช้ Template - ใช้แค่ Prompt อย่างเดียว
                </p>
              )}
            </div>
          </div>

          {/* Middle: Input Images */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-bold text-teal-900 mb-4">
                2️⃣ เลือกรูปที่ต้องการแก้ไข
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                เลือก 1-5 รูป ที่ต้องการให้ AI แก้ไข
              </p>

              {/* Upload from device */}
              <div className="mb-4">
                <label className="block w-full cursor-pointer">
                  <div className="border-2 border-dashed border-teal-300 rounded-lg p-4 text-center hover:border-teal-500 hover:bg-teal-50 transition-colors">
                    {uploadingFiles ? (
                      <div className="flex items-center justify-center gap-2">
                        <div className="animate-spin h-5 w-5 border-2 border-teal-600 border-t-transparent rounded-full"></div>
                        <span className="text-teal-600">กำลังอัพโหลด...</span>
                      </div>
                    ) : (
                      <>
                        <span className="text-3xl">📤</span>
                        <p className="text-teal-600 font-semibold mt-2">อัพโหลดจากเครื่อง</p>
                        <p className="text-xs text-gray-400 mt-1">เลือกหลายรูปได้</p>
                      </>
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => handleFileUpload(e.target.files)}
                    className="hidden"
                    disabled={uploadingFiles}
                  />
                </label>
              </div>

              <div className="flex items-center gap-4 mb-4">
                <div className="flex-1 h-px bg-gray-200"></div>
                <span className="text-gray-400 text-sm">หรือเลือกจาก Drive</span>
                <div className="flex-1 h-px bg-gray-200"></div>
              </div>

              {/* Folder Search */}
              <div className="mb-4">
                <input
                  type="text"
                  value={folderSearch}
                  onChange={(e) => setFolderSearch(e.target.value)}
                  placeholder="🔍 ค้นหาโฟลเดอร์..."
                  className="w-full px-4 py-2 border-2 border-teal-200 rounded-lg focus:border-teal-500 focus:outline-none text-black"
                />
              </div>

              {/* Folder Tree */}
              <div className="max-h-40 overflow-y-auto border-2 border-gray-100 rounded-lg p-2 mb-4">
                {isLoadingFolders ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="animate-spin h-6 w-6 border-2 border-teal-600 border-t-transparent rounded-full"></div>
                  </div>
                ) : driveFolders.length === 0 ? (
                  <p className="text-gray-400 text-center py-4">ไม่มีโฟลเดอร์</p>
                ) : (
                  driveFolders.map((drive) => {
                    const filteredFolders = filterFoldersBySearch(drive.folders, folderSearch)
                    if (folderSearch && filteredFolders.length === 0) return null
                    
                    return (
                      <div key={drive.driveId} className="mb-4">
                        <h3 className="text-xs font-semibold text-gray-500 mb-1">
                          📱 {drive.driveName}
                        </h3>
                        <FolderTree
                          folders={filteredFolders}
                          onSelectFolder={(id) => {
                            setSelectedFolderId(id)
                            setDriveImages([])
                            setDisplayedImages([])
                          }}
                          selectedFolderId={selectedFolderId}
                          imageCounts={imageCounts}
                        />
                      </div>
                    )
                  })
                )}
              </div>

              {selectedFolderId && (
                <button
                  onClick={loadDriveImages}
                  disabled={loading}
                  className="w-full bg-teal-600 hover:bg-teal-700 text-white py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 mb-4"
                >
                  {loading ? '⏳ กำลังโหลด...' : '📂 โหลดรูปจากโฟลเดอร์'}
                </button>
              )}

              {/* Image Grid */}
              {displayedImages.length > 0 && (
                <>
                  <div className="grid grid-cols-4 gap-2 max-h-60 overflow-y-auto">
                    {displayedImages.map((img) => (
                      <div
                        key={img.id}
                        onClick={() => toggleImageSelection(img)}
                        className={`relative cursor-pointer rounded-lg overflow-hidden border-3 transition-all ${
                          selectedImagesMap.has(img.id)
                            ? 'border-teal-500 ring-2 ring-teal-300'
                            : 'border-transparent hover:border-teal-200'
                        }`}
                      >
                        <Image
                          src={img.thumbnailUrl || img.url}
                          alt={img.name}
                          width={80}
                          height={80}
                          className="w-full h-16 object-cover"
                        />
                        {selectedImagesMap.has(img.id) && (
                          <div className="absolute inset-0 bg-teal-500/30 flex items-center justify-center">
                            <span className="text-lg">✓</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  
                  {displayedImages.length < driveImages.length && (
                    <button
                      onClick={loadMoreImages}
                      className="w-full mt-2 py-2 text-teal-600 hover:bg-teal-50 rounded-lg font-semibold"
                    >
                      โหลดเพิ่ม ({driveImages.length - displayedImages.length} รูป)
                    </button>
                  )}
                </>
              )}

              {/* Selected Count */}
              {selectedImagesMap.size > 0 && (
                <div className="mt-4 p-3 bg-teal-50 rounded-lg">
                  <div className="flex justify-between items-center">
                    <p className="text-sm font-semibold text-teal-700">
                      ✅ เลือกแล้ว {selectedImagesMap.size}/5 รูป
                    </p>
                    <button
                      onClick={() => setSelectedImagesMap(new Map())}
                      className="text-red-500 text-sm hover:underline"
                    >
                      ล้างทั้งหมด
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: Prompt & Options */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-bold text-teal-900 mb-4">
                3️⃣ เขียน Prompt
              </h2>
              
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="บอกว่าต้องการแก้ไขรูปอย่างไร เช่น: เปลี่ยนฟ้าเป็นพระอาทิตย์ตก, เพิ่มสระว่ายน้ำ, ทำให้ดูหรูหราขึ้น..."
                className="w-full h-32 px-4 py-3 border-2 border-teal-200 rounded-lg focus:border-teal-500 focus:outline-none resize-none text-black"
              />

              {/* Improve Prompt Toggle */}
              <div className="mt-4 mb-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableImprovePrompt}
                    onChange={(e) => setEnableImprovePrompt(e.target.checked)}
                    className="w-5 h-5 text-teal-600 rounded"
                  />
                  <div>
                    <span className="text-sm font-semibold text-gray-700">
                      ✨ Improve Prompt
                    </span>
                    <p className="text-xs text-gray-400">
                      AI ช่วยขยาย prompt ให้ละเอียดขึ้น
                    </p>
                  </div>
                </label>
              </div>

              {/* Aspect Ratio */}
              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  📐 Aspect Ratio
                </label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value as SeedreamAspectRatio)}
                  className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-teal-500 focus:outline-none text-black"
                >
                  <option value="square_1_1">1:1 - สี่เหลี่ยมจตุรัส (2048x2048)</option>
                  <option value="widescreen_16_9">16:9 - จอกว้าง (2730x1536)</option>
                  <option value="social_story_9_16">9:16 - Story/TikTok (1536x2730)</option>
                  <option value="classic_4_3">4:3 - คลาสสิก (2364x1774)</option>
                  <option value="traditional_3_4">3:4 - แนวตั้ง (1774x2364)</option>
                  <option value="standard_3_2">3:2 - Photo Print (2508x1672)</option>
                  <option value="portrait_2_3">2:3 - Pinterest (1672x2508)</option>
                  <option value="cinematic_21_9">21:9 - Cinematic (3062x1312)</option>
                </select>
              </div>
            </div>

            {/* Generate Button */}
            <button
              onClick={handleCreate}
              disabled={creating || selectedImagesMap.size === 0 || !customPrompt.trim()}
              className="w-full bg-gradient-to-r from-teal-600 to-green-600 hover:from-teal-700 hover:to-green-700 text-white py-4 rounded-xl font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
            >
              {creating ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></div>
                  กำลังส่งงาน...
                </span>
              ) : (
                <span>✨ Generate with Seedream ({selectedImagesMap.size} รูป)</span>
              )}
            </button>

            {/* Info Box */}
            <div className="bg-teal-50 rounded-xl p-4 text-sm text-teal-800">
              <h3 className="font-bold mb-2">📌 วิธีการทำงาน:</h3>
              <ol className="list-decimal list-inside space-y-1">
                <li>เลือกรูปที่ต้องการแก้ไข (1-5 รูป)</li>
                <li>เขียน Prompt บอกว่าต้องการแก้ไขอย่างไร</li>
                <li>AI Improve Prompt (ถ้าเปิดใช้)</li>
                <li>Seedream 4.5 แก้ไขรูป → 4MP Output</li>
              </ol>
              <p className="mt-3 text-xs text-teal-600">
                💡 Template ช่วยให้ AI เข้าใจ style ที่ต้องการ (ไม่บังคับ)
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
