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

export default function CustomPromptPage() {
  const router = useRouter()
  const supabase = createClient()
  
  const [user, setUser] = useState<User | null>(null)
  const [driveFolders, setDriveFolders] = useState<Array<{ driveId: string; driveName: string; folders: TreeFolder[] }>>([])
  const [selectedFolderId, setSelectedFolderId] = useState('')
  const [driveImages, setDriveImages] = useState<DriveImage[]>([])
  const [displayedImages, setDisplayedImages] = useState<DriveImage[]>([]) // 🚀 แสดงทีละน้อย
  const [selectedImagesMap, setSelectedImagesMap] = useState<Map<string, DriveImage>>(new Map())
  const [imageCounts, setImageCounts] = useState<Record<string, number>>({})
  const [customPrompt, setCustomPrompt] = useState('')
  const [outputSize, setOutputSize] = useState('match_input_image')
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [uploadingFiles, setUploadingFiles] = useState(false)
  
  // Drive management
  const [showDriveSelector, setShowDriveSelector] = useState(false)
  const [availableDrives, setAvailableDrives] = useState<Array<{ driveId: string; driveName: string }>>([])
  const [selectedDriveIds, setSelectedDriveIds] = useState<Set<string>>(new Set())
  const [savingDrives, setSavingDrives] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [loadingTimer, setLoadingTimer] = useState(0)
  const [isLoadingFolders, setIsLoadingFolders] = useState(false)
  const [excludedFolderIds, setExcludedFolderIds] = useState<Set<string>>(new Set())
  
  // Template state
  const [enableTemplate, setEnableTemplate] = useState(false)
  const [templateFolderId, setTemplateFolderId] = useState('')
  const [templateImages, setTemplateImages] = useState<DriveImage[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [templateSearch, setTemplateSearch] = useState('')
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  
  // � Process Mode: merge (รวมรูป) vs each (แยกทีละรูป)
  const [processMode, setProcessMode] = useState<'merge' | 'each'>('each')
  
  // �🔍 Search state
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

  // 💾 localStorage Cache Helpers (1 hour TTL)
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
      setLoading(false)
    }
  }

  async function handleFileUpload(files: FileList | null) {
    if (!files || files.length === 0) return

    setUploadingFiles(true)
    const uploadedImages: DriveImage[] = []

    try {
      // 🔥 Vercel Hobby Plan Limit: 4.5MB body size
      // ต้องบีบไฟล์ที่ frontend ให้เหลือไม่เกิน 4MB ก่อนส่ง
      const VERCEL_LIMIT_MB = 4
      
      // Upload files one by one, with auto-compression
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2)
        setStatus(`📤 กำลังอัพโหลด ${i + 1}/${files.length}: ${file.name} (${fileSizeMB}MB)...`)

        let fileToUpload: File | Blob = file
        const isHEIC = file.type === 'image/heic' || file.type === 'image/heif' || 
                       file.name.toLowerCase().endsWith('.heic') || 
                       file.name.toLowerCase().endsWith('.heif')
        
        // 🔥 บีบอัดทุกไฟล์ที่ใหญ่กว่า Vercel limit (รวม HEIC ด้วย)
        if (file.size > VERCEL_LIMIT_MB * 1024 * 1024) {
          setStatus(`🗜️ กำลังบีบอัด ${file.name} (${fileSizeMB}MB → <4MB)...`)
          
          try {
            const options = {
              maxSizeMB: VERCEL_LIMIT_MB, // 🔥 บีบให้เหลือไม่เกิน 4MB
              maxWidthOrHeight: 3840, // 4K resolution - รักษาคุณภาพหน้าคน
              useWebWorker: true,
              fileType: 'image/jpeg' as const,
              initialQuality: 0.9, // เริ่มจาก quality สูง
            }
            
            fileToUpload = await imageCompression(file, options)
            const compressedSizeMB = (fileToUpload.size / (1024 * 1024)).toFixed(2)
            console.log(`✅ Compressed: ${fileSizeMB}MB → ${compressedSizeMB}MB`)
            setStatus(`✅ บีบอัดแล้ว: ${fileSizeMB}MB → ${compressedSizeMB}MB`)
          } catch (err) {
            console.error(`Failed to compress ${file.name}:`, err)
            // 🔥 ถ้าบีบไม่ได้ ลองใช้ quality ต่ำลง
            try {
              setStatus(`🔄 ลองบีบอัดอีกครั้ง ${file.name}...`)
              const fallbackOptions = {
                maxSizeMB: VERCEL_LIMIT_MB,
                maxWidthOrHeight: 2560, // ลด resolution ลง
                useWebWorker: true,
                fileType: 'image/jpeg' as const,
                initialQuality: 0.7,
              }
              fileToUpload = await imageCompression(file, fallbackOptions)
              const compressedSizeMB = (fileToUpload.size / (1024 * 1024)).toFixed(2)
              console.log(`✅ Fallback compressed: ${fileSizeMB}MB → ${compressedSizeMB}MB`)
            } catch (fallbackErr) {
              console.error(`Fallback compression failed:`, fallbackErr)
              alert(`❌ ไม่สามารถบีบอัด ${file.name} ได้\nกรุณาลองใช้รูปขนาดเล็กกว่านี้`)
              continue // ข้ามไฟล์นี้
            }
          }
        } else if (isHEIC) {
          // HEIC เล็ก → แปลงเป็น JPEG ที่ frontend
          setStatus(`📱 กำลังแปลงไฟล์ iPhone ${file.name}...`)
          try {
            const options = {
              maxSizeMB: VERCEL_LIMIT_MB,
              maxWidthOrHeight: 3840,
              useWebWorker: true,
              fileType: 'image/jpeg' as const,
            }
            fileToUpload = await imageCompression(file, options)
          } catch (err) {
            console.error(`Failed to convert HEIC:`, err)
            // ถ้าแปลงไม่ได้ ส่งไป server ให้ handle
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
          const errorText = await res.text()
          console.error(`Failed to upload ${file.name}:`, errorText)
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
        console.log(`✅ Loaded ${data.images?.length || 0} template images`)
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

  async function handleCreate() {
    if (selectedImagesMap.size === 0) {
      alert('กรุณาเลือกรูปอย่างน้อย 1 รูป')
      return
    }

    if (!customPrompt.trim()) {
      alert('กรุณากรอก Prompt')
      return
    }

    if (enableTemplate && !selectedTemplate) {
      alert('กรุณาเลือก Template')
      return
    }

    // 🔥 Practical limit: 6 images for stability (+ 1 template = 7 total)
    // Based on real-world testing: 6 images = reliable, 7+ = unstable
    if (enableTemplate && selectedImagesMap.size > 6) {
      alert('⚠️ แนะนำสูงสุด 6 รูป (+ template = 7 total)')
      return
    }

    // 🔥 Merge mode limit: 10 images max
    if (processMode === 'merge' && !enableTemplate && selectedImagesMap.size > 10) {
      alert('⚠️ Merge mode รองรับสูงสุด 10 รูป')
      return
    }

    setCreating(true)
    setStatus('กำลังเตรียมรูปภาพ...')

    try {
      const selectedImages = Array.from(selectedImagesMap.values())
      if (!user) throw new Error('User not authenticated')

      // ✅ CRITICAL: Prepare temporary URLs first (for job creation)
      const tempImageUrls = selectedImages.map(img => img.url)
      const tempTemplateUrl = enableTemplate ? selectedTemplate : null

      // ✅ CREATE JOB(S) FIRST before any external API calls
      const jobIds: string[] = []
      
      if (enableTemplate && tempTemplateUrl) {
        // WITH TEMPLATE: Create single job
        const { data: job, error: jobError } = await supabase
          .from('jobs')
          .insert({
            user_id: user.id,
            user_name: user.user_metadata?.name || null,
            user_email: user.email,
            job_type: 'custom-prompt-template',
            status: 'processing',
            prompt: customPrompt,
            output_size: outputSize,
            image_urls: tempImageUrls,
            template_url: tempTemplateUrl,
            output_urls: [],
          })
          .select()
          .single()

        if (jobError) throw jobError
        jobIds.push(job.id)
      } else if (processMode === 'merge') {
        // 🔀 MERGE MODE: Create single job with all images
        const { data: job, error: jobError } = await supabase
          .from('jobs')
          .insert({
            user_id: user.id,
            user_name: user.user_metadata?.name || null,
            user_email: user.email,
            job_type: 'custom-prompt',
            status: 'processing',
            prompt: customPrompt,
            output_size: outputSize,
            image_urls: tempImageUrls, // ส่งทุกรูป
            output_urls: [],
          })
          .select()
          .single()

        if (jobError) throw jobError
        jobIds.push(job.id)
      } else {
        // 📦 EACH MODE: Create separate job for EACH image
        for (let i = 0; i < tempImageUrls.length; i++) {
          const { data: job, error: jobError } = await supabase
            .from('jobs')
            .insert({
              user_id: user.id,
              user_name: user.user_metadata?.name || null,
              user_email: user.email,
              job_type: 'custom-prompt',
              status: 'processing',
              prompt: customPrompt,
              output_size: outputSize,
              image_urls: [tempImageUrls[i]],
              output_urls: [],
            })
            .select()
            .single()

          if (jobError) throw jobError
          jobIds.push(job.id)
        }
      }

      // ✅ Parallel upload with concurrency limit (3 at a time)
      setStatus(`กำลังอัพโหลด ${selectedImages.length} รูป...`)
      
      const uploadImage = async (img: typeof selectedImages[0], index: number) => {
        try {
          if (img.url.includes('drive.google.com')) {
            const uploadRes = await fetch('/api/drive/download-and-upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileId: img.id, fileName: img.name }),
            })
            
            if (!uploadRes.ok) {
              throw new Error(`Failed to upload image ${index + 1}`)
            }
            
            const { url } = await uploadRes.json()
            return url
          } else {
            return img.url
          }
        } catch (error) {
          throw new Error(`Image ${index + 1}: ${error instanceof Error ? error.message : 'Upload failed'}`)
        }
      }

      // Upload in batches of 3 for better performance
      const imageUrls: string[] = []
      const batchSize = 3
      
      try {
        for (let i = 0; i < selectedImages.length; i += batchSize) {
          const batch = selectedImages.slice(i, i + batchSize)
          const batchPromises = batch.map((img, idx) => uploadImage(img, i + idx))
          
          setStatus(`อัพโหลด ${i + 1}-${Math.min(i + batchSize, selectedImages.length)}/${selectedImages.length}...`)
          const batchResults = await Promise.all(batchPromises)
          imageUrls.push(...batchResults)
        }
      } catch (uploadError) {
        // Mark all jobs as failed if image upload fails
        for (const jobId of jobIds) {
          await supabase.from('jobs').update({
            status: 'failed',
            error: uploadError instanceof Error ? uploadError.message : 'Image upload failed'
          }).eq('id', jobId)
        }
        throw uploadError
      }

      // Upload template image if enabled
      let finalTemplateUrl = null
      if (enableTemplate && selectedTemplate) {
        setStatus('กำลังอัพโหลด Template...')
        
        try {
          const templateImage = templateImages.find(img => img.url === selectedTemplate)
          
          if (templateImage) {
            // 🔥 เช็คว่า template เป็น Cloudinary URL หรือ Drive URL
            const isCloudinaryUrl = selectedTemplate.includes('cloudinary.com') || selectedTemplate.includes('res.cloudinary')
            
            if (isCloudinaryUrl) {
              // Template จาก Cloudinary (upload มาแล้ว) - ใช้ URL ตรงๆ
              console.log('✅ Template is already on Cloudinary:', selectedTemplate)
              finalTemplateUrl = selectedTemplate
            } else {
              // Template from Google Drive - convert to Cloudinary
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
        } catch (templateError) {
          // Mark job as failed if template upload fails
          await supabase.from('jobs').update({
            status: 'failed',
            error: templateError instanceof Error ? templateError.message : 'Template upload failed'
          }).eq('id', jobIds[0])
          throw templateError
        }

        // Update job with final template URL
        await supabase.from('jobs').update({
          template_url: finalTemplateUrl
        }).eq('id', jobIds[0])
      }

      // Update jobs with final Cloudinary URLs
      if (enableTemplate && finalTemplateUrl) {
        await supabase.from('jobs').update({
          image_urls: imageUrls
        }).eq('id', jobIds[0])
      } else if (processMode === 'merge') {
        // 🔀 MERGE MODE: single job with all images
        await supabase.from('jobs').update({
          image_urls: imageUrls
        }).eq('id', jobIds[0])
      } else {
        // 📦 EACH MODE: each job gets one image
        for (let i = 0; i < jobIds.length; i++) {
          await supabase.from('jobs').update({
            image_urls: [imageUrls[i]]
          }).eq('id', jobIds[i])
        }
      }

      // Call Replicate API(s)
      if (enableTemplate && finalTemplateUrl) {
        // 🔄 Smart Frontend Retry (3 attempts) - Template Mode
        const maxRetries = 3
        let lastError: Error | null = null
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            setStatus(attempt > 1 
              ? `🔄 Retry ${attempt}/${maxRetries}... กำลังส่งงาน` 
              : '🎨 กำลังส่งงานไป Replicate...')
            
            const response = await fetch('/api/replicate/custom-prompt', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jobId: jobIds[0],
                prompt: customPrompt,
                imageUrls: imageUrls,
                templateUrl: finalTemplateUrl,
                outputSize: outputSize,
              }),
            })

            if (!response.ok) throw new Error('Failed to create job')

            const result = await response.json()
            await supabase.from('jobs').update({ replicate_id: result.id }).eq('id', jobIds[0])
            break // Success - exit retry loop
          } catch (apiError) {
            lastError = apiError instanceof Error ? apiError : new Error('Unknown error')
            console.log(`⚠️ Template mode attempt ${attempt}/${maxRetries} failed:`, lastError.message)
            
            if (attempt < maxRetries) {
              const delayMs = 5000 * attempt
              setStatus(`⚠️ ล้มเหลว รอ ${delayMs/1000}s แล้วลองใหม่... (${attempt}/${maxRetries})`)
              await new Promise(resolve => setTimeout(resolve, delayMs))
            } else {
              // All retries failed
              await supabase.from('jobs').update({
                status: 'failed',
                error: lastError.message || 'Replicate API failed after 3 retries'
              }).eq('id', jobIds[0])
              throw lastError
            }
          }
        }
      } else if (processMode === 'merge') {
        // 🔀 MERGE MODE: Single job with all images
        const maxRetries = 3
        let lastError: Error | null = null
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            setStatus(attempt > 1 
              ? `🔄 Retry ${attempt}/${maxRetries}... กำลังส่งงาน` 
              : `🎨 กำลังส่งงาน (Merge ${imageUrls.length} รูป)...`)
            
            const response = await fetch('/api/replicate/custom-prompt', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jobId: jobIds[0],
                prompt: customPrompt,
                imageUrls: imageUrls, // ส่งทุกรูป
                templateUrl: null,
                outputSize: outputSize,
              }),
            })

            if (!response.ok) throw new Error('Failed to create job')

            const result = await response.json()
            await supabase.from('jobs').update({ replicate_id: result.id }).eq('id', jobIds[0])
            break // Success - exit retry loop
          } catch (apiError) {
            lastError = apiError instanceof Error ? apiError : new Error('Unknown error')
            console.log(`⚠️ Merge mode attempt ${attempt}/${maxRetries} failed:`, lastError.message)
            
            if (attempt < maxRetries) {
              const delayMs = 5000 * attempt
              setStatus(`⚠️ ล้มเหลว รอ ${delayMs/1000}s แล้วลองใหม่... (${attempt}/${maxRetries})`)
              await new Promise(resolve => setTimeout(resolve, delayMs))
            } else {
              // All retries failed
              await supabase.from('jobs').update({
                status: 'failed',
                error: lastError.message || 'Replicate API failed after 3 retries'
              }).eq('id', jobIds[0])
              throw lastError
            }
          }
        }
      } else {
        // 📦 EACH MODE: separate job for each image
        for (let i = 0; i < jobIds.length; i++) {
          // 🔄 Smart Frontend Retry (3 attempts) - ใช้ jobIds[i] เดิม
          const maxRetries = 3
          let jobSuccess = false
          let lastError = ''
          
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              setStatus(attempt > 1 
                ? `🔄 Retry ${attempt}/${maxRetries}... Job ${i + 1}/${jobIds.length}` 
                : `🎨 กำลังส่งงานที่ ${i + 1}/${jobIds.length}...`)
              
              const response = await fetch('/api/replicate/custom-prompt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jobId: jobIds[i],
                  prompt: customPrompt,
                  imageUrls: [imageUrls[i]],
                  templateUrl: null,
                  outputSize: outputSize,
                }),
              })

              if (!response.ok) throw new Error(`Failed to create job ${i + 1}`)

              const result = await response.json()
              await supabase.from('jobs').update({ replicate_id: result.id }).eq('id', jobIds[i])
              jobSuccess = true
              console.log(`✅ Job ${i + 1}/${jobIds.length} created successfully`)
              break // Success - exit retry loop
            } catch (apiError) {
              lastError = apiError instanceof Error ? apiError.message : 'Unknown error'
              console.log(`⚠️ Job ${i + 1} attempt ${attempt}/${maxRetries} failed:`, lastError)
              
              if (attempt < maxRetries) {
                const delayMs = 5000 * attempt
                setStatus(`⚠️ Job ${i + 1} ล้มเหลว รอ ${delayMs/1000}s... (Retry ${attempt}/${maxRetries})`)
                await new Promise(resolve => setTimeout(resolve, delayMs))
              }
            }
          }
          
          // If all retries failed for this job
          if (!jobSuccess) {
            await supabase.from('jobs').update({
              status: 'failed',
              error: lastError || 'Replicate API failed after 3 retries'
            }).eq('id', jobIds[i])
            throw new Error(`Job ${i + 1} failed after ${maxRetries} retries: ${lastError}`)
          }
            
          // 🔥 Delay 10 วินาทีก่อนทำ job ถัดไป (ป้องกัน rate limit)
          if (i < jobIds.length - 1) {
            setStatus(`⏳ รอ 10 วินาที... (${i + 1}/${jobIds.length})`)
            await new Promise(resolve => setTimeout(resolve, 10000))
          }
        }
      }

      router.push('/dashboard')
    } catch (error: unknown) {
      console.error('Error:', error)
      const message = error instanceof Error ? error.message : 'เกิดข้อผิดพลาด'
      alert(`เกิดข้อผิดพลาดในการสร้างงาน: ${message}`)
    } finally {
      setCreating(false)
      setStatus('')
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
      <div className="container mx-auto px-4 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-4xl font-bold text-purple-900 mb-2">
                🎨 Custom Prompt
              </h1>
              <p className="text-gray-600">
                เลือกรูปจาก Drive หรืออัพโหลดจากเครื่อง + เขียน Prompt + Template (ไม่บังคับ)
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
                    // ลบ cache ทั้ง localStorage และ server
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
                <p className="text-xs text-gray-500 text-center">💡 กดเมื่อมีโฟลเดอร์ใหม่</p>
              </div>
            </div>
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

        {/* Status */}
        {status && (
          <div className="mb-6 bg-blue-50 border-2 border-blue-200 text-blue-700 px-4 py-3 rounded-lg text-center font-semibold">
            {status}
          </div>
        )}

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Image Selection */}
          <div className="lg:col-span-2 space-y-6">
            {/* Drive Folders */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-purple-900">
                  1️⃣ เลือกรูปจาก Google Drive
                </h2>
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

              {/* 📂 Load Button - ย้ายมาด้านบน */}
              {selectedFolderId && (
                <button
                  onClick={loadDriveImages}
                  disabled={loading}
                  className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-semibold transition-colors disabled:opacity-50 mb-4 flex items-center justify-center gap-2"
                >
                  <span>{loading ? '⏳' : '📂'}</span>
                  <span>{loading ? 'กำลังโหลด...' : 'โหลดรูปจากโฟลเดอร์'}</span>
                </button>
              )}
              
              {/* 📁 Folder Tree - เพิ่ม scroll */}
              <div className="max-h-96 overflow-y-auto pr-2">
                {driveFolders
                  .map((drive) => {
                    // 🔍 กรองโฟลเดอร์ตามคำค้นหา
                    const filteredFolders = filterFoldersBySearch(drive.folders, folderSearch)
                    
                    // ถ้าไม่มีโฟลเดอร์ที่ตรงเงื่อนไข ไม่แสดง drive นี้
                    if (folderSearch && filteredFolders.length === 0) return null
                    
                    return (
                      <div key={drive.driveId} className="mb-6">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                            <span>📱</span>
                            <span>{drive.driveName}</span>
                          </h3>
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

              {/* Upload from Computer */}
              <div className="mt-4 p-4 bg-gradient-to-r from-orange-50 to-yellow-50 rounded-lg border-2 border-orange-200">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-orange-800">
                    📤 หรืออัพโหลดจากเครื่อง
                  </label>
                  <span className="text-xs text-orange-600">
                    JPG, PNG, WebP, HEIC (ไม่จำกัดขนาด - บีบอัดอัตโนมัติ)
                  </span>
                </div>
                <input
                  type="file"
                  id="file-upload"
                  multiple
                  accept="image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                  onChange={(e) => handleFileUpload(e.target.files)}
                  className="hidden"
                />
                <label
                  htmlFor="file-upload"
                  className={`block w-full text-center px-4 py-3 rounded-lg font-semibold cursor-pointer transition-all ${
                    uploadingFiles
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-orange-500 hover:bg-orange-600 text-white'
                  }`}
                >
                  {uploadingFiles ? '⏳ กำลังอัพโหลด...' : '📁 เลือกไฟล์จากเครื่อง'}
                </label>
              </div>
            </div>

            {/* Drive Images Grid */}
            {driveImages.length > 0 && (
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h3 className="text-lg font-bold text-purple-900 mb-4">
                  รูปในโฟลเดอร์ ({driveImages.length} รูป)
                </h3>
                <div className="grid grid-cols-4 gap-3 max-h-96 overflow-y-auto">
                  {displayedImages.map((img) => {
                    const isSelected = selectedImagesMap.has(img.id)
                    return (
                      <div
                        key={img.id}
                        onClick={() => toggleImageSelection(img)}
                        className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer transition-all ${
                          isSelected
                            ? 'ring-4 ring-purple-500 scale-95'
                            : 'ring-2 ring-gray-200 hover:ring-gray-400'
                        }`}
                      >
                        <Image
                          src={img.thumbnailUrl}
                          alt={img.name}
                          fill
                          sizes="(max-width: 768px) 50vw, 25vw"
                          className="object-cover"
                          unoptimized
                        />
                        {isSelected && (
                          <div className="absolute inset-0 bg-purple-600/30 flex items-center justify-center">
                            <span className="text-4xl">✓</span>
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
              </div>
            )}

            {/* Selected Images */}
            {selectedImagesMap.size > 0 && (
              <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl shadow-lg p-6 border-2 border-purple-200">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-purple-900">
                    ✅ รูปที่เลือกแล้ว ({selectedImagesMap.size} รูป)
                  </h3>
                  <button
                    onClick={() => setSelectedImagesMap(new Map())}
                    className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg font-semibold transition-colors"
                  >
                    🗑️ ล้างทั้งหมด
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {Array.from(selectedImagesMap.values()).map((img) => (
                    <div key={img.id} className="relative group">
                      <div className="aspect-square rounded-lg overflow-hidden border-2 border-purple-400">
                        <Image
                          src={img.thumbnailUrl}
                          alt={img.name}
                          fill
                          sizes="(max-width: 768px) 50vw, 25vw"
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                      <button
                        onClick={() => toggleImageSelection(img)}
                        className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Prompt & Settings */}
          <div className="space-y-6">
            {/* Custom Prompt */}
            {selectedImagesMap.size > 0 && (
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h3 className="text-lg font-bold text-purple-900 mb-4">
                  2️⃣ เขียน Prompt
                </h3>
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  rows={6}
                  placeholder="เช่น: ทำให้รูปสว่างขึ้น เพิ่มความคมชัด และปรับสีให้สดใส..."
                  className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-black focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                />
                <p className="text-xs text-gray-500 mt-2">
                  {customPrompt.length} ตัวอักษร
                </p>
              </div>
            )}

            {/* Output Size */}
            {selectedImagesMap.size > 0 && customPrompt.trim() && (
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h3 className="text-lg font-bold text-purple-900 mb-4">
                  📐 ขนาดรูป
                </h3>
                <select
                  value={outputSize}
                  onChange={(e) => setOutputSize(e.target.value)}
                  className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 font-medium text-gray-900 focus:ring-2 focus:ring-purple-500"
                >
                  <option value="match_input_image">🎯 ตามรูปต้นฉบับ (แนะนำ)</option>
                  <option value="1:1">1:1 Square</option>
                  <option value="2:3">2:3 Portrait</option>
                  <option value="3:2">3:2 Landscape</option>
                  <option value="3:4">3:4 Tall Portrait</option>
                  <option value="4:3">4:3 Wide</option>
                  <option value="9:16">9:16 Vertical (Story)</option>
                  <option value="16:9">16:9 Wide (Cinema)</option>
                </select>
                <p className="text-xs text-gray-500 mt-2">
                  💡 ขนาดสุดท้ายจะถูก Upscale เป็น x2 อัตโนมัติ (2K → 4K)
                </p>
              </div>
            )}

            {/* Process Mode - แสดงเมื่อไม่มี template และเลือกรูป > 1 */}
            {selectedImagesMap.size > 1 && customPrompt.trim() && !enableTemplate && (
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h3 className="text-lg font-bold text-purple-900 mb-4">
                  🔀 โหมดประมวลผล ({selectedImagesMap.size} รูป)
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setProcessMode('merge')}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      processMode === 'merge'
                        ? 'border-purple-500 bg-purple-50'
                        : 'border-gray-200 hover:border-purple-300'
                    }`}
                  >
                    <div className="text-2xl mb-2">🎨</div>
                    <div className="font-semibold text-gray-900">รวม (Merge)</div>
                    <div className="text-xs text-gray-500 mt-1">
                      ส่งทุกรูปพร้อมกัน = 1 Job<br/>
                      AI เห็นบริบททั้งหมด
                    </div>
                  </button>
                  <button
                    onClick={() => setProcessMode('each')}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      processMode === 'each'
                        ? 'border-purple-500 bg-purple-50'
                        : 'border-gray-200 hover:border-purple-300'
                    }`}
                  >
                    <div className="text-2xl mb-2">📦</div>
                    <div className="font-semibold text-gray-900">แยก (Each)</div>
                    <div className="text-xs text-gray-500 mt-1">
                      ทีละรูป = {selectedImagesMap.size} Jobs<br/>
                      ประมวลผลแยกกัน
                    </div>
                  </button>
                </div>
                {processMode === 'merge' && (
                  <p className="text-xs text-amber-600 mt-3 flex items-center gap-1">
                    
                  </p>
                )}
              </div>
            )}

            {/* Template */}
            {selectedImagesMap.size > 0 && customPrompt.trim() && (
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-purple-900">
                    {selectedImagesMap.size > 1 && !enableTemplate ? '4️⃣' : '3️⃣'} Template (ไม่บังคับ)
                  </h3>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableTemplate}
                      onChange={(e) => setEnableTemplate(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-300 peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                {enableTemplate && (
                  <div className="space-y-4">
                    {/* Folder Tree Section */}
                    <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-lg p-4 border-2 border-blue-200">
                      <h4 className="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
                        <span>📁</span>
                        <span>เลือกโฟลเดอร์ Template</span>
                      </h4>
                      
                      {/* Search Folders */}
                      <div className="mb-3">
                        <input
                          type="text"
                          value={templateSearch}
                          onChange={(e) => setTemplateSearch(e.target.value)}
                          placeholder="🔍 ค้นหาโฟลเดอร์ template... (พิมพ์ชื่อ)"
                          className="w-full border-2 border-blue-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 text-black"
                        />
                        {templateSearch && (
                          <p className="text-xs text-gray-500 mt-1">
                            กรองโฟลเดอร์ที่มี &ldquo;{templateSearch}&rdquo;
                          </p>
                        )}
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
                      <div className="max-h-64 overflow-y-auto pr-2">
                        {driveFolders.map((drive) => {
                          // 🔍 กรองโฟลเดอร์ตามคำค้นหา
                          const filteredFolders = filterFoldersBySearch(drive.folders, templateSearch)
                          
                          // ถ้าไม่มีโฟลเดอร์ที่ตรงเงื่อนไข ไม่แสดง drive นี้
                          if (templateSearch && filteredFolders.length === 0) return null
                          
                          return (
                            <div key={`template-${drive.driveId}`} className="mb-4">
                              <h5 className="text-xs font-semibold text-blue-700 mb-2">
                                🎨 {drive.driveName}
                              </h5>
                              <FolderTree
                                folders={filteredFolders}
                                onSelectFolder={setTemplateFolderId}
                                selectedFolderId={templateFolderId}
                                onDeleteFolder={(folderId, folderName) => excludeFolder(folderId, folderName, drive.driveId)}
                                driveId={drive.driveId}
                              />
                            </div>
                          )
                        })}
                      </div>

                      {/* Upload Template Button */}
                      <div className="mt-3 pt-3 border-t-2 border-blue-200">
                        <input
                          type="file"
                          id="template-upload"
                          accept="image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                          onChange={async (e) => {
                            const files = e.target.files
                            if (!files || files.length === 0) return
                            
                            setUploadingFiles(true)
                            
                            const file = files[0]
                            const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2)
                            setStatus(`📤 กำลังอัพโหลด Template: ${file.name} (${fileSizeMB}MB)...`)

                            let fileToUpload = file
                            const isHEIC = file.type === 'image/heic' || file.type === 'image/heif' || 
                                           file.name.toLowerCase().endsWith('.heic') || 
                                           file.name.toLowerCase().endsWith('.heif')
                            
                            // 🔥 Vercel Hobby limit: 4.5MB
                            const VERCEL_LIMIT_MB = 4
                            
                            if (file.size > VERCEL_LIMIT_MB * 1024 * 1024) {
                              setStatus(`🗜️ กำลังบีบอัด Template (${fileSizeMB}MB → <4MB)...`)
                              
                              try {
                                const options = {
                                  maxSizeMB: VERCEL_LIMIT_MB,
                                  maxWidthOrHeight: 3840, // 4K
                                  useWebWorker: true,
                                  fileType: 'image/jpeg' as const,
                                  initialQuality: 0.9,
                                }
                                
                                fileToUpload = await imageCompression(file, options)
                                const compressedSizeMB = (fileToUpload.size / (1024 * 1024)).toFixed(2)
                                console.log(`✅ Template compressed: ${fileSizeMB}MB → ${compressedSizeMB}MB`)
                              } catch (err) {
                                console.error('Failed to compress template:', err)
                                alert(`❌ ไม่สามารถบีบอัด Template ได้\nกรุณาลองใช้รูปขนาดเล็กกว่านี้`)
                                setUploadingFiles(false)
                                e.target.value = ''
                                return
                              }
                            } else if (isHEIC) {
                              // HEIC เล็ก → แปลงเป็น JPEG
                              try {
                                const options = {
                                  maxSizeMB: VERCEL_LIMIT_MB,
                                  maxWidthOrHeight: 3840,
                                  useWebWorker: true,
                                  fileType: 'image/jpeg' as const,
                                }
                                fileToUpload = await imageCompression(file, options)
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
                              setSelectedTemplate(uploadedTemplate.url)
                              setStatus('✅ อัพโหลด Template สำเร็จ')
                              setTimeout(() => setStatus(''), 2000)
                            } else {
                              setStatus('❌ อัพโหลด Template ล้มเหลว')
                              setTimeout(() => setStatus(''), 3000)
                            }
                            
                            setUploadingFiles(false)
                            e.target.value = ''
                          }}
                          className="hidden"
                        />
                        <label
                          htmlFor="template-upload"
                          className={`block w-full text-center px-3 py-2 rounded-lg font-semibold cursor-pointer transition-all text-sm ${
                            uploadingFiles
                              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                              : 'bg-orange-500 hover:bg-orange-600 text-white'
                          }`}
                        >
                          {uploadingFiles ? '⏳ กำลังอัพโหลด...' : '📤 อัพโหลด Template จากเครื่อง'}
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
                          {templateImages.map((img) => (
                            <div
                              key={img.id}
                              onClick={() => setSelectedTemplate(img.url)}
                              className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer transition-all ${
                                selectedTemplate === img.url
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
                                unoptimized
                              />
                              {selectedTemplate === img.url && (
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
                    {selectedTemplate && (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 text-sm text-green-700 bg-green-50 p-3 rounded-lg border border-green-200 font-medium">
                          ✅ เลือก Template แล้ว
                        </div>
                        <button
                          onClick={() => {
                            setSelectedTemplate('')
                            setEnableTemplate(false)
                          }}
                          className="px-4 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold transition-colors"
                          title="ยกเลิก Template"
                        >
                          🗑️
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Create Button */}
            {selectedImagesMap.size > 0 && customPrompt.trim() && (
              <button
                onClick={handleCreate}
                disabled={creating || (enableTemplate && !selectedTemplate)}
                className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white py-4 rounded-lg font-bold text-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
              >
                {creating ? '⏳ กำลังสร้าง...' : '🚀 สร้างงาน'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
