'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { User } from '@supabase/supabase-js'
import imageCompression from 'browser-image-compression'

export default function UpscalePage() {
  const router = useRouter()
  const supabase = createClient()
  
  const [user, setUser] = useState<User | null>(null)
  const [imageUrl, setImageUrl] = useState('')
  const [uploadedImage, setUploadedImage] = useState<{ url: string; thumbnailUrl: string } | null>(null)
  const [scale, setScale] = useState(2)
  const [faceEnhance, setFaceEnhance] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [uploadingFile, setUploadingFile] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    async function checkAuth() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      setUser(user)
    }
    checkAuth()
  }, [router, supabase])

  async function handleFileUpload(files: FileList | null) {
    if (!files || files.length === 0) return

    const file = files[0]
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
    
    // 🔥 รองรับ HEIC/HEIF ด้วย
    const isHEIC = file.type === 'image/heic' || file.type === 'image/heif' || 
                   file.name.toLowerCase().endsWith('.heic') || 
                   file.name.toLowerCase().endsWith('.heif')
    
    if (!validTypes.includes(file.type) && !isHEIC) {
      alert('รองรับเฉพาะ JPG, PNG, WebP, HEIC')
      return
    }

    setUploadingFile(true)
    
    // 🔥 Vercel Hobby Plan Limit: 4.5MB body size
    const VERCEL_LIMIT_MB = 4
    let fileToUpload: File | Blob = file
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2)

    try {
      // 🔥 บีบอัดไฟล์ใหญ่ก่อนอัพโหลด
      if (file.size > VERCEL_LIMIT_MB * 1024 * 1024) {
        setStatus(`🗄️ กำลังบีบอัด ${fileSizeMB}MB → <4MB...`)
        
        const options = {
          maxSizeMB: VERCEL_LIMIT_MB,
          maxWidthOrHeight: 3840, // 4K
          useWebWorker: true,
          fileType: 'image/jpeg' as const,
          initialQuality: 0.9,
        }
        
        fileToUpload = await imageCompression(file, options)
        const compressedSizeMB = (fileToUpload.size / (1024 * 1024)).toFixed(2)
        setStatus(`✅ บีบอัดแล้ว: ${compressedSizeMB}MB`)
      }
      
      const formData = new FormData()
      formData.append('files', fileToUpload)

      const res = await fetch('/api/upload-images', {
        method: 'POST',
        body: formData,
      })

      if (res.ok) {
        const data = await res.json()
        setUploadedImage(data.images[0])
        setImageUrl(data.images[0].url)
      } else {
        alert('อัพโหลดล้มเหลว')
      }
    } catch (error) {
      console.error('Upload error:', error)
      alert('เกิดข้อผิดพลาดในการอัพโหลด')
    } finally {
      setUploadingFile(false)
    }
  }

  async function handleUpscale() {
    if (!imageUrl.trim()) {
      setError('กรุณาอัพโหลดรูปหรือใส่ URL')
      return
    }

    if (!user) {
      setError('กรุณา login ก่อน')
      return
    }

    setCreating(true)
    setError('')

    try {
      // Create job in Supabase
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert({
          user_id: user.id,
          user_name: user.user_metadata?.name || null,
          user_email: user.email,
          job_type: 'upscale',
          status: 'processing',
          prompt: `Upscale x${scale}`,
          output_size: `x${scale}`,
          image_urls: [imageUrl],
          input_image_url: imageUrl, // 🔥 เพิ่มเพื่อแสดงรูป before ใน Dashboard
          output_urls: [],
        })
        .select()
        .single()

      if (jobError) throw jobError

      // 🔄 Smart Frontend Retry (3 attempts) - Upscale Mode
      const maxRetries = 3
      let lastError: Error | null = null
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          setStatus(attempt > 1 
            ? `🔄 Retry ${attempt}/${maxRetries}... กำลัง Upscale` 
            : '🔍 กำลัง Upscale...')
          
          const response = await fetch('/api/replicate/upscale', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jobId: job.id,
              imageUrl: imageUrl,
              scale: scale,
              faceEnhance: faceEnhance,
            }),
          })

          if (!response.ok) {
            throw new Error('Failed to upscale')
          }

          const result = await response.json()

          // Update job with replicate_id
          await supabase
            .from('jobs')
            .update({ replicate_id: result.id })
            .eq('id', job.id)

          router.push('/dashboard')
          return // Success - exit function
        } catch (apiError) {
          lastError = apiError instanceof Error ? apiError : new Error('Unknown error')
          console.log(`⚠️ Upscale attempt ${attempt}/${maxRetries} failed:`, lastError.message)
          
          if (attempt < maxRetries) {
            const delayMs = 5000 * attempt
            setStatus(`⚠️ ล้มเหลว รอ ${delayMs/1000}s แล้วลองใหม่... (${attempt}/${maxRetries})`)
            await new Promise(resolve => setTimeout(resolve, delayMs))
          }
        }
      }
      
      // All retries failed - update job status
      await supabase
        .from('jobs')
        .update({ 
          status: 'failed',
          error: lastError?.message || 'Upscale failed after 3 retries'
        })
        .eq('id', job.id)
      throw lastError
    } catch (err: unknown) {
      console.error('Error:', err)
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการ Upscale')
    } finally {
      setCreating(false)
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
          <h1 className="text-4xl font-bold text-purple-900 mb-2">
            🔍 Image Upscale
          </h1>
          <p className="text-gray-600">
            ขยายรูปภาพด้วย AI (2x, 4x) - Real-ESRGAN
          </p>
        </div>

        {/* Form */}
        <div className="bg-white rounded-2xl shadow-xl p-8 space-y-6">
          {error && (
            <div className="bg-red-50 border-2 border-red-200 text-red-700 px-4 py-3 rounded-lg">
              ⚠️ {error}
            </div>
          )}

          {/* Status */}
          {status && (
            <div className="bg-blue-50 border-2 border-blue-200 text-blue-700 px-4 py-3 rounded-lg">
              {status}
            </div>
          )}

          {/* Upload Image */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              📤 อัพโหลดรูปที่ต้องการขยาย
            </label>
            <input
              type="file"
              id="upscale-file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              onChange={(e) => handleFileUpload(e.target.files)}
              className="hidden"
            />
            <label
              htmlFor="upscale-file"
              className={`block w-full text-center px-4 py-3 rounded-lg font-semibold cursor-pointer transition-all ${
                uploadingFile
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-orange-500 hover:bg-orange-600 text-white'
              }`}
            >
              {uploadingFile ? '⏳ กำลังอัพโหลด...' : '📁 เลือกไฟล์จากเครื่อง'}
            </label>
            <p className="text-xs text-gray-500 mt-2">
              JPG, PNG, WebP (สูงสุด 10MB)
            </p>
          </div>

          {/* Or URL */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-gray-500">หรือ</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              🔗 URL รูปภาพ
            </label>
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/image.jpg"
              className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              disabled={creating}
            />
          </div>

          {/* Preview */}
          {uploadedImage && (
            <div className="bg-gradient-to-r from-purple-50 to-blue-50 p-4 rounded-lg border-2 border-purple-200">
              <div className="text-sm font-semibold text-purple-900 mb-2">
                ✅ รูปที่อัพโหลด:
              </div>
              <div className="relative w-full h-64">
                <Image
                  src={uploadedImage.thumbnailUrl}
                  alt="Preview"
                  fill
                  className="object-contain rounded-lg"
                  unoptimized
                />
              </div>
            </div>
          )}

          {/* Scale Selection */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              📏 ระดับการขยาย
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setScale(2)}
                className={`py-4 rounded-lg font-semibold text-lg transition-all ${
                  scale === 2
                    ? 'bg-purple-600 text-white shadow-lg scale-105'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                disabled={creating}
              >
                2x (เร็ว)
              </button>
              <button
                onClick={() => setScale(4)}
                className={`py-4 rounded-lg font-semibold text-lg transition-all ${
                  scale === 4
                    ? 'bg-purple-600 text-white shadow-lg scale-105'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                disabled={creating}
              >
                4x (คุณภาพสูง)
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              💡 2x = เร็วกว่า (10-20 วินาที) | 4x = คุณภาพดีกว่า (30-60 วินาที)
            </p>
          </div>

          {/* Face Enhancement */}
          <div className="bg-gradient-to-r from-pink-50 to-purple-50 border-2 border-pink-200 rounded-lg p-6">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                id="faceEnhance"
                checked={faceEnhance}
                onChange={(e) => setFaceEnhance(e.target.checked)}
                className="mt-1 w-5 h-5 text-pink-600 rounded focus:ring-2 focus:ring-pink-500"
                disabled={creating}
              />
              <div className="flex-1">
                <label htmlFor="faceEnhance" className="font-semibold text-gray-900 cursor-pointer flex items-center gap-2">
                  <span>👤</span>
                  <span>เปิดใช้ Face Enhancement (GFPGAN)</span>
                </label>
                <p className="text-sm text-gray-600 mt-2">
                  ช่วยปรับปรุงและแก้ไขใบหน้าในรูป:
                </p>
                <ul className="text-xs text-gray-600 mt-2 space-y-1 ml-4">
                  <li>✅ แก้หน้าเพี้ยน/เบลอ</li>
                  <li>✅ เพิ่มรายละเอียดใบหน้า</li>
                  <li>✅ ปรับสัดส่วนให้สมจริง</li>
                  <li>⚠️ ใช้เวลานานขึ้น 20-30%</li>
                </ul>
                <p className="text-xs text-pink-700 font-semibold mt-2 bg-pink-100 px-2 py-1 rounded">
                  💡 แนะนำสำหรับรูปคนที่หน้าไม่ชัดหรือมีปัญหา
                </p>
              </div>
            </div>
          </div>

          {/* Info */}
          {imageUrl && (
            <div className="bg-gradient-to-r from-purple-50 to-blue-50 border-2 border-purple-200 rounded-lg p-4">
              <h3 className="font-semibold text-purple-900 mb-2">📋 สรุป:</h3>
              <ul className="text-sm text-gray-700 space-y-1">
                <li>• ขยาย: {scale}x</li>
                <li>• Model: Real-ESRGAN</li>
                <li>• Face Enhancement: {faceEnhance ? '✅ เปิด (GFPGAN)' : '❌ ปิด'}</li>
                <li>• Output: PNG (คุณภาพสูง)</li>
                <li>• เวลาโดยประมาณ: {scale === 2 ? '10-20' : '30-60'} วินาที</li>
              </ul>
            </div>
          )}

          {/* Upscale Button */}
          <button
            onClick={handleUpscale}
            disabled={creating || !imageUrl.trim()}
            className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white py-4 rounded-lg font-bold text-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
          >
            {creating ? (
              <>
                <span className="inline-block animate-spin mr-2">⏳</span>
                กำลังขยายรูป...
              </>
            ) : (
              <>
                🚀 ขยายรูป {scale}x
              </>
            )}
          </button>

          {creating && (
            <div className="bg-blue-50 border-2 border-blue-200 text-blue-700 px-4 py-3 rounded-lg text-center">
              <p className="font-semibold mb-1">⏳ กำลังประมวลผล...</p>
              <p className="text-sm">
                คุณสามารถไปที่ Dashboard เพื่อติดตามความคืบหน้าได้
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
