'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

export default function UpscalePage() {
  const router = useRouter()
  const supabase = createClient()
  
  const [user, setUser] = useState<any>(null)
  const [imageUrl, setImageUrl] = useState('')
  const [uploadedImage, setUploadedImage] = useState<any>(null)
  const [scale, setScale] = useState(2)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [uploadingFile, setUploadingFile] = useState(false)

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
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    
    if (!validTypes.includes(file.type)) {
      alert('รองรับเฉพาะ JPG, PNG, WebP')
      return
    }

    const maxSize = 10 * 1024 * 1024
    if (file.size > maxSize) {
      alert('ไฟล์ใหญ่เกินไป (เกิน 10MB)')
      return
    }

    setUploadingFile(true)

    try {
      const formData = new FormData()
      formData.append('files', file)

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
          output_urls: [],
        })
        .select()
        .single()

      if (jobError) throw jobError

      // Call Replicate API
      const response = await fetch('/api/replicate/upscale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.id,
          imageUrl: imageUrl,
          scale: scale,
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
    } catch (err: any) {
      console.error('Error:', err)
      setError(err.message || 'เกิดข้อผิดพลาดในการ Upscale')
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

          {/* Info */}
          {imageUrl && (
            <div className="bg-gradient-to-r from-purple-50 to-blue-50 border-2 border-purple-200 rounded-lg p-4">
              <h3 className="font-semibold text-purple-900 mb-2">📋 สรุป:</h3>
              <ul className="text-sm text-gray-700 space-y-1">
                <li>• ขยาย: {scale}x</li>
                <li>• Model: Real-ESRGAN</li>
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
