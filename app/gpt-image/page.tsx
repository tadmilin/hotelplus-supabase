'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { User } from '@supabase/supabase-js'

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

  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (files && files.length > 0) {
      setInputImages(Array.from(files))
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
      // Upload input images if any
      let imageUrls: string[] = []
      if (inputImages.length > 0) {
        setUploading(true)
        const formData = new FormData()
        inputImages.forEach((file) => {
          formData.append('images', file)
        })

        const uploadResponse = await fetch('/api/upload-images', {
          method: 'POST',
          body: formData,
        })

        if (!uploadResponse.ok) {
          throw new Error('Failed to upload images')
        }

        const uploadData = await uploadResponse.json()
        imageUrls = uploadData.urls
        setUploading(false)
      }

      // Create job in database
      const { data: job, error: jobError } = await supabase
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
          number_of_images: numImages,
          image_urls: imageUrls,
          output_urls: [],
        })
        .select()
        .single()

      if (jobError) throw jobError

      // Call Replicate API
      const response = await fetch('/api/replicate/gpt-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create images')
      }

      const result = await response.json()

      // Update job with replicate_id
      await supabase
        .from('jobs')
        .update({ replicate_id: result.id })
        .eq('id', job.id)

      // Redirect to dashboard
      router.push('/dashboard')
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
          <h1 className="text-4xl font-bold text-purple-900 mb-2">
            🎨 GPT Image 1.5
          </h1>
          <p className="text-gray-600">
            สร้างและแก้ไขรูปด้วย OpenAI GPT Image 1.5 - ควบคุมได้อย่างแม่นยำ พร้อมอัปสเกลอัตโนมัติ
          </p>
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
                  <div key={index} className="relative">
                    <img
                      src={URL.createObjectURL(file)}
                      alt={`Preview ${index + 1}`}
                      className="w-20 h-20 object-cover rounded-lg border-2 border-purple-300"
                    />
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
      </div>
    </div>
  )
}
