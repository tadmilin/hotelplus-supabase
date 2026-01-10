'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function TextToImagePage() {
  const router = useRouter()
  const supabase = createClient()
  
  const [user, setUser] = useState<any>(null)
  const [prompt, setPrompt] = useState('')
  const [outputSize, setOutputSize] = useState('1:1')
  const [numImages, setNumImages] = useState(4)
  const [creating, setCreating] = useState(false)
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

  async function handleCreate() {
    if (!prompt.trim()) {
      setError('กรุณากรอก Prompt')
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
          job_type: 'text-to-image',
          status: 'processing',
          prompt: prompt,
          output_size: outputSize,
          image_urls: [],
          output_urls: [],
        })
        .select()
        .single()

      if (jobError) throw jobError

      // Call Replicate API
      const response = await fetch('/api/replicate/text-to-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.id,
          prompt: prompt,
          outputSize: outputSize,
          numImages: numImages,
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
    } catch (err: any) {
      console.error('Error:', err)
      setError(err.message || 'เกิดข้อผิดพลาดในการสร้างรูป')
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
            ✨ Text to Image
          </h1>
          <p className="text-gray-600">
            เขียน Prompt เพื่อสร้างรูปด้วย AI (Imagen 4 Ultra - Google)
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
              💬 Prompt (คำสั่งสร้างรูป)
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={8}
              placeholder="เช่น: A beautiful hotel room with ocean view, modern interior design, warm lighting, 4k quality, photorealistic..."
              className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
              disabled={creating}
            />
            <p className="text-xs text-gray-500 mt-2">
              💡 เคล็ดลับ: อธิบายให้ละเอียด ใช้ภาษาอังกฤษจะได้ผลลัพธ์ดีกว่า ({prompt.length} ตัวอักษร)
            </p>
          </div>

          {/* Output Size */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              📐 ขนาดรูปที่ต้องการ
            </label>
            <select
              value={outputSize}
              onChange={(e) => setOutputSize(e.target.value)}
              className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-gray-900 font-medium focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              disabled={creating}
            >
              <option value="1:1">1:1 Square (1024×1024)</option>
              <option value="3:4">3:4 Portrait (768×1024)</option>
              <option value="4:3">4:3 Landscape (1024×768)</option>
              <option value="16:9">16:9 Wide (1536×864)</option>
              <option value="9:16">9:16 Vertical (864×1536)</option>
            </select>
            <p className="text-xs text-gray-500 mt-2">
              💡 Imagen 4 Ultra รองรับทุกขนาด • หลังสร้างเสร็จจะ Upscale x2 อัตโนมัติ
            </p>
          </div>

          {/* Number of Images */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              🎨 จำนวนรูปที่ต้องการ
            </label>
            <div className="grid grid-cols-4 gap-3">
              {[1, 2, 4, 8].map((num) => (
                <button
                  key={num}
                  onClick={() => setNumImages(num)}
                  className={`py-3 rounded-lg font-semibold transition-all ${
                    numImages === num
                      ? 'bg-purple-600 text-white shadow-lg scale-105'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                  disabled={creating}
                >
                  {num} รูป
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              💰 ราคา: ~$0.04-0.08 ต่อรูป (ขึ้นอยู่กับขนาด)
            </p>
          </div>

          {/* Preview Info */}
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 border-2 border-purple-200 rounded-lg p-4">
            <h3 className="font-semibold text-purple-900 mb-2">📋 สรุป:</h3>
            <ul className="text-sm text-gray-700 space-y-1">
              <li>• Prompt: {prompt.length > 0 ? `"${prompt.substring(0, 50)}..."` : '(ยังไม่ได้กรอก)'}</li>
              <li>• ขนาด: {outputSize}</li>
              <li>• จำนวน: {numImages} รูป</li>
              <li>• Model: Imagen 4 Ultra (Google)</li>
              <li>• Upscale: x2 อัตโนมัติหลังสร้างเสร็จ</li>
              <li>• เวลาโดยประมาณ: {numImages * 15}-{numImages * 25} วินาที</li>
            </ul>
          </div>

          {/* Create Button */}
          <button
            onClick={handleCreate}
            disabled={creating || !prompt.trim()}
            className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white py-4 rounded-lg font-bold text-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
          >
            {creating ? (
              <>
                <span className="inline-block animate-spin mr-2">⏳</span>
                กำลังสร้าง... กรุณารอสักครู่
              </>
            ) : (
              <>
                🚀 สร้างรูป {numImages} รูป
              </>
            )}
          </button>

          {creating && (
            <div className="bg-blue-50 border-2 border-blue-200 text-blue-700 px-4 py-3 rounded-lg text-center">
              <p className="font-semibold mb-1">⏳ กำลังสร้างรูป...</p>
              <p className="text-sm">
                คุณสามารถไปที่ Dashboard เพื่อติดตามความคืบหน้าได้
              </p>
            </div>
          )}

          {/* Tips */}
          <div className="border-t-2 border-gray-200 pt-6 mt-6">
            <h3 className="font-semibold text-gray-700 mb-3">💡 เคล็ดลับการเขียน Prompt:</h3>
            <ul className="text-sm text-gray-600 space-y-2">
              <li>✅ ใช้ภาษาอังกฤษ (ผลลัพธ์ดีกว่า)</li>
              <li>✅ ระบุรายละเอียด (สี, แสง, มุมมอง, สไตล์)</li>
              <li>✅ ใส่คำว่า "high quality", "4k", "photorealistic"</li>
              <li>❌ หลีกเลี่ยงคำที่คลุมเครือ เช่น "beautiful", "nice"</li>
              <li>💡 ตัวอย่าง: "Modern hotel lobby with marble floor, gold accents, natural lighting from large windows, contemporary furniture, 4k quality, architectural photography"</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
