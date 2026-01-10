'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { FolderTree, type TreeFolder } from '@/components/FolderTree'

interface DriveImage {
  id: string
  name: string
  thumbnailUrl: string
  url: string
}

export default function CustomPromptPage() {
  const router = useRouter()
  const supabase = createClient()
  
  const [user, setUser] = useState<any>(null)
  const [driveFolders, setDriveFolders] = useState<Array<{ driveId: string; driveName: string; folders: TreeFolder[] }>>([])
  const [selectedFolderId, setSelectedFolderId] = useState('')
  const [driveImages, setDriveImages] = useState<DriveImage[]>([])
  const [selectedImagesMap, setSelectedImagesMap] = useState<Map<string, DriveImage>>(new Map())
  const [customPrompt, setCustomPrompt] = useState('')
  const [outputSize, setOutputSize] = useState('match_input_image')
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [uploadingFiles, setUploadingFiles] = useState(false)
  
  // Template state
  const [enableTemplate, setEnableTemplate] = useState(false)
  const [templateFolderId, setTemplateFolderId] = useState('')
  const [templateImages, setTemplateImages] = useState<DriveImage[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState('')

  useEffect(() => {
    async function checkAuth() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      setUser(user)
      await fetchDriveFolders()
    }
    checkAuth()
  }, [router, supabase])

  async function fetchDriveFolders() {
    try {
      const res = await fetch('/api/drive/list-folders')
      if (res.ok) {
        const data = await res.json()
        setDriveFolders(data.drives || [])
      }
    } catch (error) {
      console.error('Error fetching Drive folders:', error)
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
        setStatus(`✅ โหลด ${data.images.length} รูป`)
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

    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    const invalidFiles = Array.from(files).filter(file => !validTypes.includes(file.type))
    
    if (invalidFiles.length > 0) {
      alert(`ไฟล์ต่อไปนี้ไม่รองรับ: ${invalidFiles.map(f => f.name).join(', ')}\n\nรองรับเฉพาะ: JPG, PNG, WebP`)
      return
    }

    setUploadingFiles(true)
    const uploadedImages: DriveImage[] = []

    try {
      // Upload files one by one, with auto-compression if needed
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        setStatus(`📤 กำลังอัพโหลด ${i + 1}/${files.length}: ${file.name}...`)

        // Compress if file is larger than 3MB to fit in Vercel 4.5MB limit
        let fileToUpload = file
        if (file.size > 3 * 1024 * 1024) {
          setStatus(`🗜️ กำลังบีบอัดรูป ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)...`)
          fileToUpload = await compressImage(file)
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

  // Compress image using Canvas API
  async function compressImage(file: File): Promise<File> {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const img = document.createElement('img')
        img.onload = () => {
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')!
          
          // Calculate new dimensions (max 1920px)
          let width = img.width
          let height = img.height
          const maxDim = 1920
          
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = (height / width) * maxDim
              width = maxDim
            } else {
              width = (width / height) * maxDim
              height = maxDim
            }
          }
          
          canvas.width = width
          canvas.height = height
          ctx.drawImage(img, 0, 0, width, height)
          
          // Convert to blob with quality 0.8
          canvas.toBlob(
            (blob) => {
              if (blob) {
                const compressedFile = new File([blob], file.name, {
                  type: 'image/jpeg',
                  lastModified: Date.now(),
                })
                resolve(compressedFile)
              } else {
                resolve(file)
              }
            },
            'image/jpeg',
            0.8
          )
        }
        img.src = e.target?.result as string
      }
      reader.readAsDataURL(file)
    })
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
        alert('Failed to load templates')
      }
    } catch (error) {
      console.error('Error loading templates:', error)
      alert('Error loading templates')
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

    setCreating(true)
    setStatus('กำลังเตรียมรูปภาพ...')

    try {
      const selectedImages = Array.from(selectedImagesMap.values())

      // Upload images to Cloudinary if from Drive
      const imageUrls = []
      for (let i = 0; i < selectedImages.length; i++) {
        const img = selectedImages[i]
        setStatus(`กำลังอัพโหลดรูปที่ ${i + 1}/${selectedImages.length}...`)
        
        // If image is from Drive (has webContentLink), download and upload
        if (img.url.includes('drive.google.com')) {
          const uploadRes = await fetch('/api/drive/download-and-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId: img.id, fileName: img.name }),
          })
          
          if (uploadRes.ok) {
            const { url } = await uploadRes.json()
            imageUrls.push(url)
          }
        } else {
          imageUrls.push(img.url)
        }
      }

      // Upload template image if enabled
      let finalTemplateUrl = null
      if (enableTemplate && selectedTemplate) {
        setStatus('กำลังอัพโหลด Template...')
        
        // Find template image object
        const templateImage = templateImages.find(img => img.url === selectedTemplate)
        
        if (templateImage) {
          // If from Drive, download and upload to Cloudinary
          if (selectedTemplate.includes('drive.google.com')) {
            const uploadRes = await fetch('/api/drive/download-and-upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileId: templateImage.id, fileName: templateImage.name }),
            })
            
            if (uploadRes.ok) {
              const { url } = await uploadRes.json()
              finalTemplateUrl = url
            }
          } else {
            // Already uploaded to Cloudinary
            finalTemplateUrl = selectedTemplate
          }
        }
      }

      // Create job(s) based on template usage
      if (enableTemplate && finalTemplateUrl) {
        // WITH TEMPLATE: Create single job with all images
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
            image_urls: imageUrls,
            output_urls: [],
          })
          .select()
          .single()

        if (jobError) throw jobError

        const response = await fetch('/api/replicate/custom-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId: job.id,
            prompt: customPrompt,
            imageUrls: imageUrls,
            templateUrl: finalTemplateUrl,
            outputSize: outputSize,
          }),
        })

        if (!response.ok) throw new Error('Failed to create job')

        const result = await response.json()
        await supabase
          .from('jobs')
          .update({ replicate_id: result.id })
          .eq('id', job.id)
      } else {
        // NO TEMPLATE: Create separate job for EACH image
        for (let i = 0; i < imageUrls.length; i++) {
          setStatus(`🎨 กำลังสร้างงานที่ ${i + 1}/${imageUrls.length}...`)
          
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
              image_urls: [imageUrls[i]],  // Only this image
              output_urls: [],
            })
            .select()
            .single()

          if (jobError) throw jobError

          const response = await fetch('/api/replicate/custom-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jobId: job.id,
              prompt: customPrompt,
              imageUrls: [imageUrls[i]],  // Send only one image
              templateUrl: null,
              outputSize: outputSize,
            }),
          })

          if (!response.ok) throw new Error(`Failed to create job ${i + 1}`)

          const result = await response.json()
          await supabase
            .from('jobs')
            .update({ replicate_id: result.id })
            .eq('id', job.id)
        }
      }

      router.push('/dashboard')
    } catch (error: any) {
      console.error('Error:', error)
      alert('เกิดข้อผิดพลาดในการสร้างงาน')
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
          <h1 className="text-4xl font-bold text-purple-900 mb-2">
            🎨 Custom Prompt
          </h1>
          <p className="text-gray-600">
            เลือกรูปจาก Drive หรืออัพโหลดจากเครื่อง + เขียน Prompt + Template (ไม่บังคับ)
          </p>
        </div>

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
              <h2 className="text-xl font-bold text-purple-900 mb-4">
                1️⃣ เลือกรูปจาก Google Drive
              </h2>
              
              {driveFolders.map((drive) => (
                <div key={drive.driveId} className="mb-6">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                    <span>📱</span>
                    <span>{drive.driveName}</span>
                  </h3>
                  <FolderTree
                    folders={drive.folders}
                    onSelectFolder={setSelectedFolderId}
                    selectedFolderId={selectedFolderId}
                  />
                </div>
              ))}

              {selectedFolderId && (
                <button
                  onClick={loadDriveImages}
                  disabled={loading}
                  className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-semibold transition-colors disabled:opacity-50"
                >
                  📂 โหลดรูปจากโฟลเดอร์
                </button>
              )}

              {/* Upload from Computer */}
              <div className="mt-4 p-4 bg-gradient-to-r from-orange-50 to-yellow-50 rounded-lg border-2 border-orange-200">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-orange-800">
                    📤 หรืออัพโหลดจากเครื่อง
                  </label>
                  <span className="text-xs text-orange-600">
                    JPG, PNG, WebP (สูงสุด 10MB/ไฟล์)
                  </span>
                </div>
                <input
                  type="file"
                  id="file-upload"
                  multiple
                  accept="image/jpeg,image/jpg,image/png,image/webp"
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
                  {driveImages.map((img) => {
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
                  className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
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
                  className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 font-medium focus:ring-2 focus:ring-purple-500"
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

            {/* Template */}
            {selectedImagesMap.size > 0 && customPrompt.trim() && (
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-purple-900">
                    3️⃣ Template (ไม่บังคับ)
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
                    {/* Template Folders */}
                    {driveFolders.map((drive) => (
                      <div key={`template-${drive.driveId}`}>
                        <h4 className="text-xs font-semibold text-blue-700 mb-2">
                          🎨 {drive.driveName}
                        </h4>
                        <FolderTree
                          folders={drive.folders}
                          onSelectFolder={setTemplateFolderId}
                          selectedFolderId={templateFolderId}
                        />
                      </div>
                    ))}

                    {/* Upload Template */}
                    <div className="p-4 bg-blue-50 rounded-lg border-2 border-blue-200">
                      <input
                        type="file"
                        id="template-upload"
                        accept="image/jpeg,image/jpg,image/png,image/webp"
                        onChange={async (e) => {
                          const files = e.target.files
                          if (!files || files.length === 0) return
                          
                          setUploadingFiles(true)
                          const formData = new FormData()
                          formData.append('files', files[0])

                          const res = await fetch('/api/upload-images', {
                            method: 'POST',
                            body: formData,
                          })

                          if (res.ok) {
                            const data = await res.json()
                            const uploadedTemplate = data.images[0]
                            // Add to templateImages state so it can be found later
                            setTemplateImages(prev => [uploadedTemplate, ...prev])
                            // Auto-select it
                            setSelectedTemplate(uploadedTemplate.url)
                          }
                          setUploadingFiles(false)
                          e.target.value = ''
                        }}
                        className="hidden"
                      />
                      <label
                        htmlFor="template-upload"
                        className="block w-full text-center px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-semibold cursor-pointer"
                      >
                        📁 อัพโหลด Template
                      </label>
                    </div>

                    {templateFolderId && (
                      <button
                        onClick={loadTemplateImages}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-semibold"
                      >
                        โหลด Template
                      </button>
                    )}

                    {/* Template Images */}
                    {templateImages.length > 0 && (
                      <div className="grid grid-cols-3 gap-2">
                        {templateImages.map((img) => (
                          <div
                            key={img.id}
                            onClick={() => setSelectedTemplate(img.url)}
                            className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer ${
                              selectedTemplate === img.url
                                ? 'ring-4 ring-blue-500'
                                : 'ring-2 ring-gray-200'
                            }`}
                          >
                            <Image
                              src={img.thumbnailUrl}
                              alt={img.name}
                              fill
                              className="object-cover"
                              unoptimized
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {selectedTemplate && (
                      <div className="text-sm text-green-700 bg-green-50 p-2 rounded">
                        ✅ เลือก Template แล้ว
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
