'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { User } from '@supabase/supabase-js'
import Image from 'next/image'
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
  const [displayedImages, setDisplayedImages] = useState<DriveImage[]>([]) // 🚀 Lazy loading
  const [selectedDriveImages, setSelectedDriveImages] = useState<DriveImage[]>([])
  const [imageCounts, setImageCounts] = useState<Record<string, number>>({})
  const [loadingImages, setLoadingImages] = useState(false)
  const [status, setStatus] = useState('')
  const [loadingTimer, setLoadingTimer] = useState(0)
  const [isLoadingFolders, setIsLoadingFolders] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [availableDrives, setAvailableDrives] = useState<Array<{ driveId: string; driveName: string }>>([])
  const [showDriveSelector, setShowDriveSelector] = useState(false)
  const [selectedDriveIds, setSelectedDriveIds] = useState<Set<string>>(new Set())
  const [savingDrives, setSavingDrives] = useState(false)
  const [excludedFolderIds, setExcludedFolderIds] = useState<Set<string>>(new Set())
  
  // 🔍 Search state
  const [folderSearch, setFolderSearch] = useState('')

  // Template Mode (GPT → Nano Banana Pro Pipeline)
  const [useTemplate, setUseTemplate] = useState(false)
  const [templateFile, setTemplateFile] = useState<File | null>(null)
  
  // Template from Google Drive
  const [templateFolderId, setTemplateFolderId] = useState('')
  const [templateImages, setTemplateImages] = useState<DriveImage[]>([])
  const [displayedTemplateImages, setDisplayedTemplateImages] = useState<DriveImage[]>([])
  const [selectedTemplateUrl, setSelectedTemplateUrl] = useState('')
  const [templateSearch, setTemplateSearch] = useState('')
  const [loadingTemplates, setLoadingTemplates] = useState(false)

  // 🚀 Lazy load template images
  useEffect(() => {
    if (templateImages.length === 0) {
      setDisplayedTemplateImages([])
      return
    }

    let filtered = templateImages
    if (templateSearch.trim()) {
      const searchLower = templateSearch.toLowerCase()
      filtered = templateImages.filter(img => 
        img.name.toLowerCase().includes(searchLower)
      )
    }

    setDisplayedTemplateImages(filtered.slice(0, 50))

    if (filtered.length > 50) {
      const timer = setTimeout(() => {
        setDisplayedTemplateImages(filtered)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [templateImages, templateSearch])

  useEffect(() => {
    async function checkAuth() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      setUser(user)
      await loadAvailableDrives()
      
      // ✅ โหลด excluded folders ก่อน แล้วค่อยโหลดโฟลเดอร์
      // เพื่อให้แน่ใจว่ากรองถูกต้อง
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

  async function deleteDriveFolder(driveId: string, driveName: string) {
    const confirmed = confirm(
      `⚠️ ลบ Drive "${driveName}" ออกจากรายการของคุณ?\n\n` +
      `✅ จะลบ: Drive นี้จากรายการของคุณเท่านั้น\n` +
      `❌ จะไม่ลบ: ไฟล์จริงใน Google Drive (ยังคงอยู่)\n` +
      `❌ จะไม่กระทบ: User อื่นที่ใช้ Drive นี้\n\n` +
      `คุณสามารถเพิ่มกลับมาได้ด้วยปุ่ม "🔄 Sync Drives"`
    )

    if (!confirmed) return

    try {
      const res = await fetch('/api/drive/user-drives', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driveId }),
      })

      if (res.ok) {
        alert('✅ ลบออกจากรายการของคุณแล้ว! (Sync ใหม่ได้ตลอดเวลา)')
        await fetchDriveFolders()
      } else {
        alert('❌ ลบไม่สำเร็จ')
      }
    } catch {
      alert('❌ เกิดข้อผิดพลาด')
    }
  }

  async function loadTemplateImages() {
    if (!templateFolderId) return
    
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
        
        // ⚡ อัพเดทจำนวนรูปในโฟลเดอร์นี้
        setImageCounts(prev => ({
          ...prev,
          [templateFolderId]: data.images.length
        }))
      } else {
        alert('ไม่สามารถโหลด Template ได้')
      }
    } catch (err) {
      console.error('Load template error:', err)
      alert('เกิดข้อผิดพลาดในการโหลด Template')
    } finally {
      setLoadingTemplates(false)
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
        // ⚠️ โหลด excluded folders ก่อน แล้วค่อย fetch drives
        // เพื่อให้ state อัปเดตก่อนกรองโฟลเดอร์
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

  // 🔍 ฟังก์ชันกรองโฟลเดอร์ตามคำค้นหา
  // ถ้าโฟลเดอร์ match → แสดง children ทั้งหมดด้วย (ไม่ filter children)
  function filterFoldersBySearch(folders: TreeFolder[], searchTerm: string): TreeFolder[] {
    if (!searchTerm) return folders
    
    const searchLower = searchTerm.toLowerCase()
    const filtered: TreeFolder[] = []
    
    for (const folder of folders) {
      // ✅ ตรวจสอบว่าชื่อโฟลเดอร์มีคำค้นหาหรือไม่
      const nameMatch = folder.name.toLowerCase().includes(searchLower)
      
      if (nameMatch) {
        // 🔥 ถ้าชื่อตรง → เอาโฟลเดอร์นี้ พร้อม children ทั้งหมด (ไม่ filter)
        filtered.push(folder)
      } else {
        // ถ้าชื่อไม่ตรง → ลองหาใน children
        const filteredChildren = folder.children ? filterFoldersBySearch(folder.children, searchTerm) : []
        
        if (filteredChildren.length > 0) {
          // มี children ที่ตรง → เอา parent ไว้ด้วย
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
    
    // Start timer
    const timerInterval = setInterval(() => {
      setLoadingTimer(prev => prev + 0.1)
    }, 100)
    
    try {
      // ⚠️ IMPORTANT: โหลด excluded folders ก่อนเสมอ
      await loadExcludedFolders()
      
      // 💾 เช็ค localStorage cache ก่อน
      const cacheKey = 'drive_folders_cache'
      const cached = localStorage.getItem(cacheKey)
      
      if (cached) {
        try {
          const { data, timestamp } = JSON.parse(cached)
          const ageInMinutes = (Date.now() - timestamp) / (1000 * 60)
          
          // ถ้าไม่เกิน 60 นาที ใช้ cache
          if (ageInMinutes < 60) {
            console.log(`✅ Using cached folders (${ageInMinutes.toFixed(1)} นาทีที่แล้ว)`)
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
          console.log('Cache parse error, fetching fresh data')
        }
      }
      
      // ไม่มี cache หรือหมดอายุ → โหลดใหม่
      setStatus('🔄 กำลังโหลดโฟลเดอร์จาก Google Drive...')
      
      const res = await fetch('/api/drive/list-folders')
      if (res.ok) {
        const data = await res.json()
        
        // 💾 บันทึก cache
        localStorage.setItem(cacheKey, JSON.stringify({
          data: data.drives || [],
          timestamp: Date.now()
        }))
        
        // กรองโฟลเดอร์ที่ถูก exclude ออก
        const filteredDrives = (data.drives || []).map((drive: { driveId: string; driveName: string; folders: TreeFolder[] }) => ({
          ...drive,
          folders: filterExcludedFolders(drive.folders)
        }))
        setDriveFolders(filteredDrives)
        
        setStatus(`✅ โหลด ${data.drives?.length || 0} drives สำเร็จ ใช้เวลา ${loadingTimer.toFixed(1)} วินาที`)
        setTimeout(() => setStatus(''), 3000)
      } else {
        setStatus('❌ โหลดล้มเหลว')
      }
    } catch (error) {
      console.error('Error fetching Drive folders:', error)
      setStatus('❌ เกิดข้อผิดพลาด')
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

    setLoadingImages(true)
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
        setDisplayedImages((data.images || []).slice(0, 100)) // 🚀 โชว์ 100 รูปก่อน
        
        // ⚡ อัพเดทจำนวนรูปในโฟลเดอร์นี้
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
      
      // 🔥 Vercel Hobby Plan Limit: 4.5MB body size
      const VERCEL_LIMIT_MB = 4
      const compressedFiles: File[] = []
      
      for (const file of Array.from(files)) {
        const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2)
        
        // 🔥 ตรวจสอบว่าเป็น HEIC/HEIF หรือไม่
        const isHEIC = file.type === 'image/heic' || file.type === 'image/heif' || 
                       file.name.toLowerCase().endsWith('.heic') || 
                       file.name.toLowerCase().endsWith('.heif')
        
        // 🔥 บีบอัดทุกไฟล์ที่ใหญ่กว่า Vercel limit หรือเป็น HEIC
        if (file.size > VERCEL_LIMIT_MB * 1024 * 1024) {
          console.log(`🔄 Compressing: ${file.name} (${fileSizeMB}MB)`)
          
          try {
            const options = {
              maxSizeMB: VERCEL_LIMIT_MB,
              maxWidthOrHeight: 3840, // 4K resolution - รักษาคุณภาพหน้าคน
              useWebWorker: true,
              fileType: 'image/jpeg' as const,
              initialQuality: 0.9,
            }
            
            const compressed = await imageCompression(file, options)
            const compressedSizeMB = (compressed.size / (1024 * 1024)).toFixed(2)
            console.log(`✅ Compressed: ${fileSizeMB}MB → ${compressedSizeMB}MB`)
            
            compressedFiles.push(compressed)
          } catch (err) {
            console.error(`Failed to compress ${file.name}:`, err)
            // 🔥 ลองบีบอัดอีกครั้งด้วย quality ต่ำลง
            try {
              const fallbackOptions = {
                maxSizeMB: VERCEL_LIMIT_MB,
                maxWidthOrHeight: 2560,
                useWebWorker: true,
                fileType: 'image/jpeg' as const,
                initialQuality: 0.7,
              }
              const compressed = await imageCompression(file, fallbackOptions)
              compressedFiles.push(compressed)
            } catch {
              compressedFiles.push(file) // Use original if compression fails
            }
          }
        } else if (isHEIC) {
          // 🔥 HEIC เล็ก → แปลงเป็น JPEG ที่ frontend
          console.log(`📱 Converting HEIC: ${file.name}`)
          try {
            const options = {
              maxSizeMB: VERCEL_LIMIT_MB,
              maxWidthOrHeight: 3840,
              useWebWorker: true,
              fileType: 'image/jpeg' as const,
            }
            const converted = await imageCompression(file, options)
            compressedFiles.push(converted)
          } catch (err) {
            console.error(`Failed to convert HEIC:`, err)
            compressedFiles.push(file) // ส่งไป server ให้ handle
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
      let finalTemplateUrl = null
      if (useTemplate) {
        setUploading(true)
        
        // Check if template is from Google Drive (selected URL) or uploaded file
        if (selectedTemplateUrl) {
          // 🔥 เช็คว่า template เป็น Cloudinary URL หรือ Drive URL
          const isCloudinaryUrl = selectedTemplateUrl.includes('cloudinary.com') || selectedTemplateUrl.includes('res.cloudinary')
          
          if (isCloudinaryUrl) {
            // Template จาก Cloudinary (upload มาแล้ว) - ใช้ URL ตรงๆ
            console.log('✅ Template is already on Cloudinary:', selectedTemplateUrl)
            finalTemplateUrl = selectedTemplateUrl
          } else {
            // Template from Google Drive - convert to Cloudinary
            console.log('📤 Converting Drive template to Cloudinary...')
          
            try {
              const templateImg = templateImages.find(img => img.url === selectedTemplateUrl)
            
              if (!templateImg) {
                throw new Error('ไม่พบไฟล์ Template ที่เลือก กรุณาเลือกใหม่')
              }
            
              if (!templateImg.id || !templateImg.name) {
                throw new Error('ข้อมูล Template ไม่สมบูรณ์ (ไม่มี ID หรือชื่อไฟล์)')
              }
            
              console.log(`📤 Processing template: ${templateImg.name} (ID: ${templateImg.id})`)
            
              const response = await fetch('/api/drive/download-and-upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  fileId: templateImg.id,
                  fileName: templateImg.name,
                }),
              })

              if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                const errorMsg = errorData.error || 'Unknown error'
                throw new Error(`ไม่สามารถแปลง Template ได้: ${errorMsg}`)
              }

              const data = await response.json()
            
              if (!data.url) {
                throw new Error('API ไม่ส่ง URL กลับมา')
              }
            
              finalTemplateUrl = data.url
              console.log('✅ Drive template converted:', finalTemplateUrl)
            } catch (templateError) {
              await supabase
                .from('jobs')
                .update({ 
                  status: 'failed',
                  error: templateError instanceof Error ? templateError.message : 'Template conversion failed'
                })
                .eq('id', job.id)
              throw templateError
            }
          }
        } else if (templateFile) {
          // Template from file upload
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
            finalTemplateUrl = templateData.images[0]?.url
            
            if (!finalTemplateUrl) {
              throw new Error('ไม่พบ URL ของ Template')
            }

            console.log('✅ Template uploaded:', finalTemplateUrl)
          } catch (templateError) {
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

        if (finalTemplateUrl) {
          // Update job with template URL
          await supabase
            .from('jobs')
            .update({ template_url: finalTemplateUrl })
            .eq('id', job.id)

          jobData.template_url = finalTemplateUrl
        }
        
        setUploading(false)
      }

      // 🔥 แยกโหมด: template กับไม่มี template
      if (useTemplate && jobData.template_url) {
        // ✅ TEMPLATE MODE: ส่งรูปทั้งหมดใน 1 job (แบบเดิม)
        const apiBody: Record<string, unknown> = {
          jobId: job.id,
          prompt: prompt,
          background: background,
          moderation: moderation,
          inputFidelity: inputFidelity,
          outputCompression: outputCompression,
          aspectRatio: aspectRatio,
          numberOfImages: numImages,
          quality: quality,
          outputFormat: outputFormat,
          inputImages: imageUrls,
          templateUrl: jobData.template_url,
        }

        try {
          const response = await fetch('/api/replicate/gpt-with-template', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(apiBody),
          })

          if (!response.ok) {
            const errorData = await response.json()
            throw new Error(errorData.error || 'Failed to create images')
          }

          console.log('✅ Template mode: 1 job created')
          router.push('/dashboard')
        } catch (apiError) {
          await supabase
            .from('jobs')
            .update({ 
              status: 'failed',
              error: apiError instanceof Error ? apiError.message : 'Replicate API failed'
            })
            .eq('id', job.id)
          throw apiError
        }
      } else if (imageUrls.length > 0) {
        // ✅ NO TEMPLATE + มีรูป: แยกรูปละ 1 job (แบบ custom-prompt)
        // ต้องลบ job แรกที่สร้างไว้ เพราะจะสร้าง N jobs แทน
        await supabase.from('jobs').delete().eq('id', job.id)
        
        const results = { success: 0, failed: 0, errors: [] as string[] }
        
        for (let i = 0; i < imageUrls.length; i++) {
          let separateJob: { id: string } | null = null
          
          try {
            // สร้าง job แยกสำหรับรูปแต่ละรูป
            const { data: jobData, error: separateJobError } = await supabase
              .from('jobs')
              .insert({
                user_id: user.id,
                user_name: user.user_metadata?.name || null,
                user_email: user.email,
                job_type: 'gpt-image',
                status: 'processing',
                prompt: prompt,
                aspect_ratio: aspectRatio,
                quality: quality,
                output_format: outputFormat,
                background: background,
                moderation: moderation,
                input_fidelity: inputFidelity,
                output_compression: outputCompression,
                number_of_images: 1, // 🔥 Hardcode = 1 (รูปละ 1 output)
                image_urls: [imageUrls[i]], // ส่งแค่รูปเดียว
                output_urls: [],
              })
              .select()
              .single()

            if (separateJobError || !jobData) {
              console.error(`❌ Job ${i + 1}/${imageUrls.length} creation failed:`, separateJobError)
              results.failed++
              results.errors.push(`Job ${i + 1}: ${separateJobError?.message || 'Failed to create job'}`)
              continue
            }

            separateJob = jobData

            // Call Replicate API
            const response = await fetch('/api/replicate/gpt-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jobId: jobData.id,
                prompt: prompt,
                aspectRatio: aspectRatio,
                numberOfImages: 1, // 🔥 Hardcode = 1 (รูปละ 1 output)
                quality: quality,
                outputFormat: outputFormat,
                background: background,
                moderation: moderation,
                inputFidelity: inputFidelity,
                outputCompression: outputCompression,
                inputImages: [imageUrls[i]], // ส่งแค่รูปเดียว
              }),
            })

            if (!response.ok) {
              const errorData = await response.json()
              console.error(`❌ Job ${i + 1}/${imageUrls.length} API failed:`, errorData.error)
              
              // Update job status to failed
              await supabase
                .from('jobs')
                .update({ 
                  status: 'failed',
                  error: errorData.error || 'API call failed'
                })
                .eq('id', jobData.id)
              
              results.failed++
              results.errors.push(`Job ${i + 1}: ${errorData.error}`)
              continue
            }

            results.success++
            console.log(`✅ Job ${i + 1}/${imageUrls.length} created successfully`)
          } catch (jobErr: unknown) {
            console.error(`❌ Job ${i + 1}/${imageUrls.length} error:`, jobErr)
            const errMsg = jobErr instanceof Error ? jobErr.message : 'Unknown error'
            
            // Update job status to failed if job was created
            if (separateJob?.id) {
              await supabase
                .from('jobs')
                .update({ 
                  status: 'failed',
                  error: errMsg
                })
                .eq('id', separateJob.id)
            }
            
            results.failed++
            results.errors.push(`Job ${i + 1}: ${errMsg}`)
          }
        }

        // แสดงผลสรุป
        if (results.success > 0 && results.failed === 0) {
          // สำเร็จทั้งหมด
          console.log(`✅ Created ${results.success} separate jobs`)
          router.push('/dashboard')
        } else if (results.success > 0 && results.failed > 0) {
          // สำเร็จบางส่วน
          setError(`สร้างสำเร็จ ${results.success}/${imageUrls.length} jobs | ล้มเหลว: ${results.failed} jobs`)
          setTimeout(() => router.push('/dashboard'), 3000)
        } else {
          // ล้มเหลวทั้งหมด
          throw new Error(`สร้างล้มเหลวทั้งหมด: ${results.errors[0] || 'Unknown error'}`)
        }
      } else {
        // ✅ NO TEMPLATE + ไม่มีรูป: ส่ง prompt อย่างเดียว (1 job)
        const apiBody: Record<string, unknown> = {
          jobId: job.id,
          prompt: prompt,
          background: background,
          moderation: moderation,
          inputFidelity: inputFidelity,
          outputCompression: outputCompression,
          aspectRatio: aspectRatio,
          numberOfImages: numImages,
          quality: quality,
          outputFormat: outputFormat,
        }

        try {
          const response = await fetch('/api/replicate/gpt-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(apiBody),
          })

          if (!response.ok) {
            const errorData = await response.json()
            throw new Error(errorData.error || 'Failed to create images')
          }

          const result = await response.json()

          if (result.id) {
            await supabase
              .from('jobs')
              .update({ replicate_id: result.id })
              .eq('id', job.id)
          }

          console.log('✅ Text-only mode: 1 job created')
          router.push('/dashboard')
        } catch (apiError) {
          await supabase
            .from('jobs')
            .update({ 
              status: 'failed',
              error: apiError instanceof Error ? apiError.message : 'Replicate API failed'
            })
            .eq('id', job.id)
          throw apiError
        }
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
                  // ลบ cache ทั้ง localStorage และ server
                  localStorage.removeItem('drive_folders_cache')
                  try {
                    await fetch('/api/drive/list-folders', { method: 'DELETE' })
                  } catch {}
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
          {status && (
            <div className="bg-blue-50 border-2 border-blue-200 text-blue-700 px-4 py-3 rounded-lg text-center font-semibold">
              {status}
            </div>
          )}
          
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
              className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-black focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
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
                      setSelectedTemplateUrl('')
                    }
                  }}
                  className="w-5 h-5 text-orange-500 rounded focus:ring-2 focus:ring-orange-500"
                  disabled={creating}
                />
                <span className="text-sm font-semibold text-gray-700">เปิดใช้งาน</span>
              </label>
            </div>

            {useTemplate && (
              <div className="space-y-4">
                <div className="bg-blue-50 border-l-4 border-blue-400 p-4">
                  <p className="text-sm text-blue-800">
                    💡 เลือก Template จาก Google Drive หรืออัพโหลดจากเครื่อง
                  </p>
                </div>

                {/* Folder Tree + Upload Section */}
                <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-lg p-4 border-2 border-blue-200">
                  <h4 className="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
                    <span>📁</span>
                    <span>เลือกโฟลเดอร์ Template จาก Google Drive</span>
                  </h4>
                  
                  {/* Search */}
                  <div className="mb-3">
                    <input
                      type="text"
                      value={templateSearch}
                      onChange={(e) => setTemplateSearch(e.target.value)}
                      placeholder="🔍 ค้นหาชื่อ template..."
                      className="w-full border-2 border-blue-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 text-black"
                    />
                  </div>

                  {/* Load Button */}
                  {templateFolderId && (
                    <button
                      onClick={loadTemplateImages}
                      disabled={loadingTemplates}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 mb-3 flex items-center justify-center gap-2 text-sm"
                    >
                      <span>{loadingTemplates ? '⏳' : '📂'}</span>
                      <span>{loadingTemplates ? 'กำลังโหลด...' : 'โหลด Template จากโฟลเดอร์'}</span>
                    </button>
                  )}

                  {/* Folder Tree */}
                  <div className="max-h-64 overflow-y-auto pr-2 mb-3">
                    {driveFolders.map((drive) => (
                      <div key={`template-${drive.driveId}`} className="mb-4">
                        <h5 className="text-xs font-semibold text-blue-700 mb-2">
                          🎨 {drive.driveName}
                        </h5>
                        <FolderTree
                          folders={drive.folders}
                          onSelectFolder={setTemplateFolderId}
                          selectedFolderId={templateFolderId}
                          onDeleteFolder={(folderId, folderName) => excludeFolder(folderId, folderName, drive.driveId)}
                          driveId={drive.driveId}
                        />
                      </div>
                    ))}
                  </div>

                  {/* Upload Button */}
                  <div className="pt-3 border-t-2 border-blue-200">
                    <input
                      type="file"
                      id="gpt-template-upload"
                      accept="image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                      onChange={async (e) => {
                        const file = e.target.files?.[0]
                        if (!file) return

                        setUploading(true)
                        const VERCEL_LIMIT_MB = 4
                        const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2)
                        
                        try {
                          let fileToUpload: File | Blob = file
                          
                          // 🔥 ตรวจสอบว่าเป็น HEIC/HEIF หรือไม่
                          const isHEIC = file.type === 'image/heic' || file.type === 'image/heif' || 
                                         file.name.toLowerCase().endsWith('.heic') || 
                                         file.name.toLowerCase().endsWith('.heif')
                          
                          if (file.size > VERCEL_LIMIT_MB * 1024 * 1024) {
                            console.log(`🗜️ Compressing template: ${fileSizeMB}MB → <4MB`)
                            
                            try {
                              fileToUpload = await imageCompression(file, {
                                maxSizeMB: VERCEL_LIMIT_MB,
                                maxWidthOrHeight: 3840, // 4K resolution
                                useWebWorker: true,
                                fileType: 'image/jpeg',
                                initialQuality: 0.9,
                              })
                              console.log(`✅ Compressed to: ${(fileToUpload.size / (1024 * 1024)).toFixed(2)}MB`)
                            } catch (err) {
                              console.error('Failed to compress template:', err)
                              setError('❌ ไม่สามารถบีบอัด Template ได้')
                              setUploading(false)
                              e.target.value = ''
                              return
                            }
                          } else if (isHEIC) {
                            // 🔥 HEIC เล็ก → แปลงเป็น JPEG
                            console.log(`📱 Converting HEIC template: ${file.name}`)
                            try {
                              fileToUpload = await imageCompression(file, {
                                maxSizeMB: VERCEL_LIMIT_MB,
                                maxWidthOrHeight: 3840,
                                useWebWorker: true,
                                fileType: 'image/jpeg',
                              })
                            } catch (err) {
                              console.error('Failed to convert HEIC:', err)
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
                            const uploadedTemplate = data.images[0]
                            setTemplateImages(prev => [uploadedTemplate, ...prev])
                            setSelectedTemplateUrl(uploadedTemplate.url)
                            setError('')
                          } else {
                            setError('ไม่สามารถอัพโหลด Template ได้')
                          }
                        } catch (err) {
                          console.error('Template error:', err)
                          setError('เกิดข้อผิดพลาดในการอัพโหลด Template')
                        } finally {
                          setUploading(false)
                        }
                        e.target.value = ''
                      }}
                      className="hidden"
                      disabled={creating || uploading}
                    />
                    <label
                      htmlFor="gpt-template-upload"
                      className={`block w-full text-center px-3 py-2 rounded-lg font-semibold cursor-pointer transition-all text-sm ${
                        uploading
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-orange-500 hover:bg-orange-600 text-white'
                      }`}
                    >
                      {uploading ? '⏳ กำลังอัพโหลด...' : '📤 อัพโหลด Template จากเครื่อง'}
                    </label>
                  </div>
                </div>

                {/* Template Images Grid */}
                {templateImages.length > 0 && (
                  <div className="bg-white rounded-lg p-4 border-2 border-blue-200">
                    <h4 className="text-sm font-semibold text-blue-900 mb-3">
                      🎨 Template ที่มี ({templateImages.length} รูป)
                    </h4>
                    <div className="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto">
                      {displayedTemplateImages.map((img) => (
                        <div
                          key={img.id}
                          onClick={() => setSelectedTemplateUrl(img.url)}
                          className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer transition-all ${
                            selectedTemplateUrl === img.url
                              ? 'ring-4 ring-blue-500 scale-95'
                              : 'ring-2 ring-gray-200 hover:ring-blue-300'
                          }`}
                        >
                          <Image
                            src={img.thumbnailUrl}
                            alt={img.name}
                            fill
                            sizes="(max-width: 768px) 50vw, 20vw"
                            className="object-cover"
                          />
                          {selectedTemplateUrl === img.url && (
                            <div className="absolute inset-0 bg-blue-500 bg-opacity-20 flex items-center justify-center">
                              <span className="text-4xl">✓</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Selected Template Info */}
                {selectedTemplateUrl && (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 text-sm text-green-700 bg-green-50 p-3 rounded-lg border border-green-200 font-medium">
                      ✅ เลือก Template แล้ว
                    </div>
                    <button
                      onClick={() => {
                        setSelectedTemplateUrl('')
                        setTemplateFile(null)
                      }}
                      className="px-4 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold transition-colors"
                      title="ยกเลิก Template"
                      disabled={creating}
                    >
                      🗑️
                    </button>
                  </div>
                )}
              </div>
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
              
              {/* 🔍 Search Box */}
              <div className="mb-4">
                <input
                  type="text"
                  value={folderSearch}
                  onChange={(e) => setFolderSearch(e.target.value)}
                  placeholder="🔍 ค้นหาโฟลเดอร์... (พิมพ์ชื่อ)"
                  className="w-full px-4 py-2 border-2 border-purple-200 rounded-lg focus:border-purple-500 focus:outline-none text-black"
                />
                {folderSearch && (
                  <p className="text-xs text-gray-500 mt-1">
                    กรองโฟลเดอร์ที่มี &ldquo;{folderSearch}&rdquo;
                  </p>
                )}
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Folder Tree */}
                <div>
                  <div className="bg-white rounded-lg p-4 max-h-96 overflow-y-auto">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">โฟลเดอร์:</h4>
                    {driveFolders.map((drive) => {
                      // 🔍 กรองโฟลเดอร์ตามคำค้นหา
                      const filteredFolders = filterFoldersBySearch(drive.folders, folderSearch)
                      
                      // ถ้าไม่มีโฟลเดอร์ที่ตรงเงื่อนไข ไม่แสดง drive นี้
                      if (folderSearch && filteredFolders.length === 0) return null
                      
                      return (
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
                            folders={filteredFolders}
                            onSelectFolder={setSelectedFolderId}
                            selectedFolderId={selectedFolderId}
                            imageCounts={imageCounts}
                            onDeleteFolder={(folderId, folderName) => excludeFolder(folderId, folderName, drive.driveId)}
                            driveId={drive.driveId}
                          />
                        </div>
                      )
                    })}
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
                  {displayedImages.length > 0 ? (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        {displayedImages.map((img) => {
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
                      
                      {/* Load More Button */}
                      {displayedImages.length < driveImages.length && (
                        <button
                          onClick={() => setDisplayedImages(prev => [
                            ...prev,
                            ...driveImages.slice(prev.length, prev.length + 100)
                          ])}
                          className="mt-4 w-full px-4 py-3 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-lg font-semibold transition-all"
                        >
                          📥 โหลดเพิ่ม ({driveImages.length - displayedImages.length} รูปเหลือ)
                        </button>
                      )}
                    </>
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
              className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-black focus:ring-2 focus:ring-purple-500 focus:border-transparent"
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
              className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-black focus:ring-2 focus:ring-purple-500 focus:border-transparent"
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
              className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-black focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              disabled={creating}
            />
          </div>

          {/* Advanced Settings */}
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl p-6 border-2 border-purple-200">
            <h3 className="text-lg font-bold text-gray-900 mb-4">⚙️ การตั้งค่าขั้นสูง</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Quality */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  ✨ คุณภาพ (Quality)
                </label>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                  className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-black focus:ring-2 focus:ring-purple-500"
                  disabled={creating}
                >
                  <option value="auto">Auto (แนะนำ)</option>
                  <option value="high">High</option>
                  <option value="low">Low</option>
                </select>
              </div>

              {/* Output Format */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  📁 รูปแบบไฟล์ (Output Format)
                </label>
                <select
                  value={outputFormat}
                  onChange={(e) => setOutputFormat(e.target.value)}
                  className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-black focus:ring-2 focus:ring-purple-500"
                  disabled={creating}
                >
                  <option value="webp">WebP (เล็กที่สุด)</option>
                  <option value="png">PNG</option>
                  <option value="jpg">JPG</option>
                </select>
              </div>

              {/* Background */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  🖼️ พื้นหลัง (Background)
                </label>
                <select
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                  className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-black focus:ring-2 focus:ring-purple-500"
                  disabled={creating}
                >
                  <option value="auto">Auto</option>
                  <option value="preserve">Preserve (รักษาพื้นหลังเดิม)</option>
                  <option value="remove">Remove (ลบพื้นหลัง)</option>
                </select>
              </div>

              {/* Moderation */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  🛡️ Moderation
                </label>
                <select
                  value={moderation}
                  onChange={(e) => setModeration(e.target.value)}
                  className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-black focus:ring-2 focus:ring-purple-500"
                  disabled={creating}
                >
                  <option value="auto">Auto (แนะนำ)</option>
                  <option value="strict">Strict</option>
                  <option value="off">Off</option>
                </select>
              </div>

              {/* Input Fidelity */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  🎯 Input Fidelity
                </label>
                <select
                  value={inputFidelity}
                  onChange={(e) => setInputFidelity(e.target.value)}
                  className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-black focus:ring-2 focus:ring-purple-500"
                  disabled={creating}
                >
                  <option value="low">Low (Creative)</option>
                  <option value="medium">Medium</option>
                  <option value="high">High (ใกล้เคียงต้นฉบับ)</option>
                </select>
              </div>

              {/* Output Compression */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  🗜️ Compression: {outputCompression}%
                </label>
                <input
                  type="range"
                  min="60"
                  max="100"
                  value={outputCompression}
                  onChange={(e) => setOutputCompression(parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  disabled={creating}
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>เล็กกว่า</span>
                  <span>คุณภาพสูง</span>
                </div>
              </div>
            </div>

            <div className="mt-4 bg-blue-50 border-l-4 border-blue-400 p-3">
              <p className="text-xs text-blue-800">
                💡 <strong>Input Fidelity:</strong> Low = AI สร้างสรรค์มากขึ้น | High = ใกล้เคียงรูปต้นฉบับ
              </p>
            </div>
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
