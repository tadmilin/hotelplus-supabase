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

type FreepikModel = 'realism' | 'flux_1_1_ultra' | 'mystic' | 'ideogram'
type FreepikResolution = '1k' | '2k' | '4k'
type FreepikAspectRatio = 'square_1_1' | 'classic_4_3' | 'traditional_3_4' | 'widescreen_16_9' | 'social_story_9_16' | 'standard_3_2'

export default function FreepikPage() {
  const router = useRouter()
  const supabase = createClient()
  
  const [user, setUser] = useState<User | null>(null)
  const [driveFolders, setDriveFolders] = useState<Array<{ driveId: string; driveName: string; folders: TreeFolder[] }>>([])
  const [excludedFolderIds, setExcludedFolderIds] = useState<Set<string>>(new Set())
  
  // Drive management
  const [showDriveSelector, setShowDriveSelector] = useState(false)
  const [availableDrives, setAvailableDrives] = useState<Array<{ driveId: string; driveName: string }>>([])
  const [selectedDriveIds, setSelectedDriveIds] = useState<Set<string>>(new Set())
  const [savingDrives, setSavingDrives] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [isLoadingFolders, setIsLoadingFolders] = useState(false)
  const [loadingTimer, setLoadingTimer] = useState(0)
  
  // Template/Reference image state
  const [templateFolderId, setTemplateFolderId] = useState('')
  const [templateImages, setTemplateImages] = useState<DriveImage[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [templateSearch, setTemplateSearch] = useState('')
  const [uploadingTemplate, setUploadingTemplate] = useState(false)
  
  // Prompt state
  const [customPrompt, setCustomPrompt] = useState('')
  
  // Freepik options
  const [model, setModel] = useState<FreepikModel>('mystic')
  const [resolution, setResolution] = useState<FreepikResolution>('2k')
  const [aspectRatio, setAspectRatio] = useState<FreepikAspectRatio>('square_1_1')
  const [useStyleReference, setUseStyleReference] = useState(true)
  
  // UI state
  const [creating, setCreating] = useState(false)
  const [status, setStatus] = useState('')

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

  async function loadTemplateImages() {
    if (!templateFolderId) {
      alert('กรุณาเลือกโฟลเดอร์ก่อน')
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
        setStatus(`✅ โหลด ${data.images?.length || 0} รูป`)
        setTimeout(() => setStatus(''), 3000)
      } else {
        alert('ไม่สามารถโหลดรูปได้')
      }
    } catch (error) {
      console.error('Load images error:', error)
      alert('เกิดข้อผิดพลาด')
    } finally {
      setLoadingTemplates(false)
    }
  }

  // 📤 Upload from device
  async function handleTemplateUpload(files: FileList | null) {
    if (!files || files.length === 0) return

    setUploadingTemplate(true)
    setStatus('📤 กำลังอัพโหลดรูป Reference...')

    try {
      const VERCEL_LIMIT_MB = 4
      const file = files[0] // Only take first file for template
      let fileToUpload: File | Blob = file
      
      // Compress if needed
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
          // Try fallback compression
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

      // Handle HEIC files
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
          
          // Add to template images and select it
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

  async function handleGenerate() {
    if (!customPrompt.trim()) {
      alert('กรุณากรอก Prompt (คำอธิบายสิ่งที่ต้องการ)')
      return
    }

    setCreating(true)
    setStatus('🎨 กำลังเตรียม...')

    try {
      if (!user) throw new Error('User not authenticated')

      // Prepare template URL if selected
      let templateUrl: string | undefined

      if (selectedTemplate) {
        setStatus('📤 กำลังอัพโหลด Reference Image...')
        
        const templateImage = templateImages.find(img => img.url === selectedTemplate)
        
        if (templateImage) {
          const isCloudinaryUrl = selectedTemplate.includes('cloudinary.com')
          
          if (isCloudinaryUrl) {
            templateUrl = selectedTemplate
          } else {
            const uploadRes = await fetch('/api/drive/download-and-upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileId: templateImage.id, fileName: templateImage.name }),
            })
            
            if (uploadRes.ok) {
              const { url } = await uploadRes.json()
              templateUrl = url
            } else {
              throw new Error('Reference image upload failed')
            }
          }
        }
      }

      // Create job in database
      setStatus('📝 กำลังสร้าง Job...')
      
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert({
          user_id: user.id,
          user_name: user.user_metadata?.name || null,
          user_email: user.email,
          job_type: 'freepik',
          status: 'processing',
          prompt: customPrompt,
          template_url: templateUrl || null,
          output_size: `${resolution}_${aspectRatio}`,
          image_urls: templateUrl ? [templateUrl] : [],
          output_urls: [],
        })
        .select()
        .single()

      if (jobError) throw jobError

      // Call Freepik API
      setStatus('🎨 กำลังส่งไป Freepik AI...')
      
      const response = await fetch('/api/freepik/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.id,
          templateUrl: templateUrl || null,
          customPrompt: customPrompt,
          model: model,
          resolution: resolution,
          aspectRatio: aspectRatio,
          useStyleReference: useStyleReference && !!templateUrl,
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
      <div className="container mx-auto px-4 max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-4xl font-bold text-teal-900 mb-2">
                🎨 Freepik AI Generate
              </h1>
              <p className="text-gray-600">
                สร้างรูปด้วย Freepik Mystic AI - เลือก Reference Image (ไม่บังคับ) + เขียน Prompt
              </p>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className="bg-teal-100 text-teal-700 text-xs px-2 py-1 rounded-full font-semibold">
                  ✨ Image to Prompt
                </span>
                <span className="bg-teal-100 text-teal-700 text-xs px-2 py-1 rounded-full font-semibold">
                  ✨ Improve Prompt
                </span>
                <span className="bg-teal-100 text-teal-700 text-xs px-2 py-1 rounded-full font-semibold">
                  ✨ Mystic 4K
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
                <p className="text-xs text-gray-500 text-center">💡 กดเมื่อมีโฟลเดอร์ใหม่</p>
              </div>
            </div>
          </div>
        </div>

        {/* Drive Selector Modal */}
        {showDriveSelector && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-gray-800">⚙️ เลือก Drives ที่ต้องการแสดง</h2>
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

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left: Reference Image Selection */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-bold text-teal-900 mb-4">
                1️⃣ เลือก Reference Image (ไม่บังคับ)
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                AI จะวิเคราะห์ style จากรูปนี้และสร้างรูปใหม่ที่มี style คล้ายกัน
              </p>
              
              {/* Upload from device */}
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
                        <p className="text-teal-600 font-semibold mt-2">อัพโหลดจากเครื่อง</p>
                        <p className="text-xs text-gray-400 mt-1">รองรับ JPG, PNG, HEIC</p>
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

              {/* Search */}
              <div className="mb-4">
                <input
                  type="text"
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                  placeholder="🔍 ค้นหาโฟลเดอร์..."
                  className="w-full px-4 py-2 border-2 border-teal-200 rounded-lg focus:border-teal-500 focus:outline-none text-black"
                />
              </div>

              {/* Folder Tree */}
              <div className="max-h-48 overflow-y-auto border-2 border-gray-100 rounded-lg p-2 mb-4">
                {isLoadingFolders ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin h-6 w-6 border-2 border-teal-600 border-t-transparent rounded-full"></div>
                    <span className="ml-2 text-gray-500">กำลังโหลด...</span>
                  </div>
                ) : driveFolders.length === 0 ? (
                  <p className="text-gray-400 text-center py-4">ไม่มีโฟลเดอร์</p>
                ) : (
                  driveFolders.map((drive) => {
                    const filteredFolders = filterFoldersBySearch(drive.folders, templateSearch)
                    if (templateSearch && filteredFolders.length === 0) return null
                    
                    return (
                      <div key={drive.driveId} className="mb-4">
                        <h3 className="text-xs font-semibold text-gray-500 mb-1">
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

              {/* Load Templates Button */}
              {templateFolderId && (
                <button
                  onClick={loadTemplateImages}
                  disabled={loadingTemplates}
                  className="w-full bg-teal-600 hover:bg-teal-700 text-white py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 mb-4"
                >
                  {loadingTemplates ? '⏳ กำลังโหลด...' : '📂 โหลดรูปจากโฟลเดอร์'}
                </button>
              )}

              {/* Template Grid */}
              {templateImages.length > 0 && (
                <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
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
                        className="w-full h-24 object-cover"
                      />
                      {selectedTemplate === img.url && (
                        <div className="absolute inset-0 bg-teal-500/30 flex items-center justify-center">
                          <span className="text-2xl">✓</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Selected Template Preview */}
              {selectedTemplate && (
                <div className="mt-4 p-3 bg-teal-50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-teal-700">✅ Reference Image เลือกแล้ว</p>
                    <button
                      onClick={() => setSelectedTemplate('')}
                      className="text-red-500 hover:text-red-700 text-sm"
                    >
                      ✕ ยกเลิก
                    </button>
                  </div>
                  <Image
                    src={selectedTemplate}
                    alt="Selected reference"
                    width={200}
                    height={150}
                    className="w-full max-h-40 object-contain rounded"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Right: Prompt & Options */}
          <div className="space-y-6">
            {/* Prompt */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-bold text-teal-900 mb-4">
                2️⃣ เขียน Prompt
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                บอกว่าต้องการสร้างรูปแบบไหน - AI จะ Improve Prompt ให้อัตโนมัติ
              </p>
              
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="เช่น: ภาพโรงแรมริมทะเลยามพระอาทิตย์ตก, สระว่ายน้ำสีฟ้าใส, บรรยากาศสุดหรู..."
                className="w-full h-32 px-4 py-3 border-2 border-teal-200 rounded-lg focus:border-teal-500 focus:outline-none resize-none text-black"
              />

              <p className="text-xs text-gray-400 mt-2">
                💡 ระบบจะเพิ่ม &quot;NO TEXT, NO LOGO&quot; อัตโนมัติ
              </p>
            </div>

            {/* Options */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-bold text-teal-900 mb-4">
                3️⃣ ตั้งค่า
              </h2>

              {/* Model */}
              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  🎨 Model
                </label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value as FreepikModel)}
                  className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-teal-500 focus:outline-none text-black"
                >
                  <option value="mystic">Mystic - คุณภาพสูง (แนะนำ)</option>
                  <option value="flux_1_1_ultra">Flux 1.1 Ultra - เร็ว, หลากหลาย</option>
                  <option value="realism">Realism - ภาพสมจริง</option>
                  <option value="ideogram">Ideogram - สร้างสรรค์</option>
                </select>
              </div>

              {/* Resolution */}
              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  📐 Resolution
                </label>
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as FreepikResolution)}
                  className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-teal-500 focus:outline-none text-black"
                >
                  <option value="1k">1K - เร็ว</option>
                  <option value="2k">2K - สมดุล (แนะนำ)</option>
                  <option value="4k">4K - คุณภาพสูงสุด</option>
                </select>
              </div>

              {/* Aspect Ratio */}
              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  📏 Aspect Ratio
                </label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value as FreepikAspectRatio)}
                  className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-teal-500 focus:outline-none text-black"
                >
                  <option value="square_1_1">1:1 - สี่เหลี่ยมจตุรัส</option>
                  <option value="classic_4_3">4:3 - คลาสสิก</option>
                  <option value="traditional_3_4">3:4 - แนวตั้ง</option>
                  <option value="widescreen_16_9">16:9 - จอกว้าง</option>
                  <option value="social_story_9_16">9:16 - Story/TikTok</option>
                  <option value="standard_3_2">3:2 - มาตรฐาน</option>
                </select>
              </div>

              {/* Style Reference Toggle */}
              {selectedTemplate && (
                <div className="mb-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useStyleReference}
                      onChange={(e) => setUseStyleReference(e.target.checked)}
                      className="w-5 h-5 text-teal-600 rounded"
                    />
                    <span className="text-sm font-semibold text-gray-700">
                      ใช้ Reference เป็น Style Reference
                    </span>
                  </label>
                  <p className="text-xs text-gray-400 mt-1 ml-8">
                    AI จะพยายามสร้างรูปที่มี style คล้าย reference
                  </p>
                </div>
              )}
            </div>

            {/* Generate Button */}
            <button
              onClick={handleGenerate}
              disabled={creating || !customPrompt.trim()}
              className="w-full bg-gradient-to-r from-teal-600 to-green-600 hover:from-teal-700 hover:to-green-700 text-white py-4 rounded-xl font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
            >
              {creating ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></div>
                  กำลังสร้าง...
                </span>
              ) : (
                <span>✨ Generate with Freepik AI</span>
              )}
            </button>

            {/* Info Box */}
            <div className="bg-teal-50 rounded-xl p-4 text-sm text-teal-800">
              <h3 className="font-bold mb-2">📌 วิธีการทำงาน:</h3>
              <ol className="list-decimal list-inside space-y-1">
                <li>ถ้าเลือก Reference → AI จะวิเคราะห์ style (Image to Prompt)</li>
                <li>AI จะขยาย prompt ให้ละเอียด (Improve Prompt)</li>
                <li>เพิ่ม &quot;NO TEXT, NO LOGO&quot; อัตโนมัติ</li>
                <li>Mystic AI สร้างรูป</li>
              </ol>
              <p className="mt-3 text-xs text-teal-600">
                ⚠️ ผลลัพธ์จะมี &quot;style คล้าย&quot; reference แต่ layout อาจไม่เหมือน 100%
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
