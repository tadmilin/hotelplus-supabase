'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

interface Job {
  id: string
  user_id: string
  user_name: string | null
  user_email: string | null
  job_type: string | null
  status: string
  prompt: string | null
  template_type: string | null
  template_url: string | null
  output_size: string | null
  image_urls: string[]
  output_urls: string[]
  error: string | null
  replicate_id: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  progress?: number  // 0-100
  _originalCount?: number  // จำนวนรูปต้นฉบับก่อนรวม upscale
}

// Helper: แปลง Drive URL → Cached Cloudinary URL
async function getCachedUrl(url: string): Promise<string> {
  // ถ้าเป็น Cloudinary อยู่แล้ว → ใช้เลย
  if (url.includes('cloudinary.com') || url.includes('res.cloudinary.com')) {
    return url
  }
  
  // ถ้าเป็น Drive URL → ดึง fileId แล้วขอ cached URL
  if (url.includes('drive.google.com') || url.includes('googleusercontent.com')) {
    try {
      // Extract fileId from Drive URL
      let fileId: string | null = null
      const fileName = 'unknown'
      
      if (url.includes('/file/d/')) {
        fileId = url.split('/file/d/')[1]?.split('/')[0]
      } else if (url.includes('id=')) {
        fileId = url.split('id=')[1]?.split('&')[0]
      }
      
      if (!fileId) {
        console.warn('Could not extract fileId from Drive URL:', url)
        return url // fallback
      }
      
      // Call cache API
      const response = await fetch(`/api/drive/get-cached-url?fileId=${fileId}&fileName=${encodeURIComponent(fileName)}`)
      
      if (response.ok) {
        const data = await response.json()
        return data.url
      } else {
        console.error('Failed to get cached URL:', response.statusText)
        return url // fallback
      }
    } catch (error) {
      console.error('Error getting cached URL:', error)
      return url // fallback
    }
  }
  
  // ไม่ใช่ Drive URL → ใช้ตัวเดิม
  return url
}

export default function DashboardPage() {
  const router = useRouter()
  const supabase = createClient()
  
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [cachedUrls, setCachedUrls] = useState<Map<string, string>>(new Map()) // URL cache

  const fetchJobs = useCallback(async (showLoadingSpinner = true) => {
    if (showLoadingSpinner) setLoading(true)
    
    try {
      // ดึง jobs ทั้งหมดไม่จำกัด (ยกเว้น upscale)
      let query = supabase
        .from('jobs')
        .select('*')
        .neq('job_type', 'upscale')  // ← ซ่อน job upscale
        .order('created_at', { ascending: false })
      
      // ถ้าไม่ใช่ admin ดึงแค่งานของตัวเอง
      if (!isAdmin && userId) {
        query = query.eq('user_id', userId)
      }

      const { data, error } = await query

      if (error) throw error
      setJobs(data || [])
    } catch (error) {
      console.error('Error fetching jobs:', error)
    } finally {
      if (showLoadingSpinner) setLoading(false)
    }
  }, [supabase, isAdmin, userId])

  useEffect(() => {
    // Check auth
    async function checkAuth() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      setUserId(user.id)
      
      // เช็คว่าเป็น admin หรือไม่จาก admin_users table
      const { data: adminData } = await supabase
        .from('admin_users')
        .select('user_id')
        .eq('user_id', user.id)
        .single()
      
      const adminStatus = !!adminData
      setIsAdmin(adminStatus)
      
      if (adminStatus) {
        console.log('👑 Admin mode: viewing all jobs')
      }
      
      await fetchJobs()
    }
    checkAuth()
  }, [router, supabase, fetchJobs])

  // Real-time subscription
  useEffect(() => {
    if (!userId) return

    const channel = supabase
      .channel('jobs-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'jobs',
          // Admin ฟังทุก job, User ธรรมดาฟังแค่ของตัวเอง
          filter: isAdmin ? undefined : `user_id=eq.${userId}`,
        },
        (payload) => {
          console.log('Real-time update:', payload)
          fetchJobs(false) // Silent refresh
        }
      )
      .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }, [supabase, fetchJobs, userId, isAdmin])

  // Auto-refresh every 5 seconds as fallback
  useEffect(() => {
    const interval = setInterval(() => {
      fetchJobs(false)
    }, 5000)
    return () => clearInterval(interval)
  }, [fetchJobs])

  function getStatusColor(status: string): string {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-300'
      case 'processing':
        return 'bg-blue-100 text-blue-800 border-blue-300'
      case 'failed':
        return 'bg-red-100 text-red-800 border-red-300'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300'
    }
  }

  function getStatusIcon(status: string): string {
    switch (status) {
      case 'completed':
        return '✅'
      case 'processing':
        return '⏳'
      case 'failed':
        return '❌'
      default:
        return '⏸️'
    }
  }

  function formatDate(dateString: string): string {
    const date = new Date(dateString)
    return date.toLocaleString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  function calculateDuration(startDate: string, endDate: string | null) {
    if (!endDate) return null
    const start = new Date(startDate).getTime()
    const end = new Date(endDate).getTime()
    const diffMs = end - start
    
    if (diffMs < 0) return null
    
    const seconds = Math.floor(diffMs / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    
    if (hours > 0) {
      return `${hours} ชม. ${minutes % 60} นาที`
    } else if (minutes > 0) {
      return `${minutes} นาที ${seconds % 60} วินาที`
    } else {
      return `${seconds} วินาที`
    }
  }
  
  // Helper: Get optimized image URL (with caching)
  async function getOptimizedUrl(url: string): Promise<string> {
    // Check cache first
    if (cachedUrls.has(url)) {
      return cachedUrls.get(url)!
    }
    
    // Get cached URL
    const optimizedUrl = await getCachedUrl(url)
    
    // Store in cache
    setCachedUrls(prev => new Map(prev).set(url, optimizedUrl))
    
    return optimizedUrl
  }

  async function handleViewImages(job: Job) {
    try {
      // ดึง upscale jobs ที่เกี่ยวข้อง
      const { data: upscaleJobs } = await supabase
        .from('jobs')
        .select('*')
        .eq('job_type', 'upscale')
        .ilike('prompt', `%from job ${job.id}%`)
        .eq('status', 'completed')
      
      // เก็บจำนวนรูปต้นฉบับเพื่อแยก section
      const originalCount = job.output_urls?.length || 0
      
      // รวมรูป upscale เข้ากับ job หลัก
      if (upscaleJobs && upscaleJobs.length > 0) {
        const upscaleUrls = upscaleJobs.flatMap(j => j.output_urls || [])
        job = {
          ...job,
          output_urls: [...(job.output_urls || []), ...upscaleUrls],
          _originalCount: originalCount
        }
      }
      
      setSelectedJob(job)
      setShowModal(true)
    } catch (error) {
      console.error('Error fetching upscale images:', error)
      setSelectedJob(job)
      setShowModal(true)
    }
  }

  function handleEditWithGemini(imageUrl: string) {
    // ส่งไปหน้า Gemini Edit พร้อม URL รูป
    router.push(`/gemini-edit?imageUrl=${encodeURIComponent(imageUrl)}`)
  }

  async function handleDeleteJob(jobId: string) {
    if (!confirm('คุณแน่ใจหรือไม่ที่จะลบงานนี้? การดำเนินการนี้ไม่สามารถย้อนกลับได้')) {
      return
    }

    setDeleting(jobId)

    try {
      const { error } = await supabase
        .from('jobs')
        .delete()
        .eq('id', jobId)

      if (error) throw error

      // Remove from local state
      setJobs(jobs.filter(j => j.id !== jobId))
      
      // Close modal if this job is being viewed
      if (selectedJob?.id === jobId) {
        setShowModal(false)
        setSelectedJob(null)
      }

      alert('✅ ลบงานสำเร็จ')
    } catch (error) {
      console.error('Error deleting job:', error)
      alert('❌ ลบงานล้มเหลว')
    } finally {
      setDeleting(null)
    }
  }

  // Component: Optimized Image with caching
  function OptimizedImage({ url, alt, className }: { url: string, alt: string, className?: string }) {
    const [displayUrl, setDisplayUrl] = useState(url)
    const [imgLoading, setImgLoading] = useState(true)

    useEffect(() => {
      async function loadUrl() {
        setImgLoading(true)
        const optimized = await getOptimizedUrl(url)
        setDisplayUrl(optimized)
        setImgLoading(false)
      }
      loadUrl()
    }, [url])

    // Show loading state
    if (imgLoading) {
      return (
        <div className="absolute inset-0 bg-gray-200 animate-pulse flex items-center justify-center">
          <span className="text-gray-400 text-sm">⏳</span>
        </div>
      )
    }

    // Optimize Cloudinary URLs
    const finalUrl = displayUrl.includes('cloudinary.com')
      ? displayUrl.replace('/upload/', '/upload/f_auto,q_70,w_400,c_fill,fl_progressive/')
      : displayUrl

    return (
      <Image
        src={finalUrl}
        alt={alt}
        fill
        className={`object-cover ${className || ''}`}
        loading="lazy"
        unoptimized
      />
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">⏳</div>
          <p className="text-xl text-gray-600">กำลังโหลด Dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 py-8">
      <div className="container mx-auto px-4">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-4xl font-bold text-purple-900">
              📊 Dashboard
            </h1>
            {isAdmin && (
              <span className="px-3 py-1 bg-yellow-100 border-2 border-yellow-400 text-yellow-800 rounded-full text-sm font-bold">
                👑 ADMIN MODE
              </span>
            )}
          </div>
          <p className="text-gray-600">
            {isAdmin ? 'งานของทุกคน' : 'งานของคุณ'} {jobs.length} งาน • อัพเดทอัตโนมัติทุก 5 วินาที
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl p-6 shadow-md border-2 border-purple-200">
            <div className="text-3xl mb-2">📋</div>
            <div className="text-2xl font-bold text-purple-900">{jobs.length}</div>
            <div className="text-sm text-gray-600">งานทั้งหมด</div>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-md border-2 border-green-200">
            <div className="text-3xl mb-2">✅</div>
            <div className="text-2xl font-bold text-green-900">
              {jobs.filter(j => j.status === 'completed').length}
            </div>
            <div className="text-sm text-gray-600">สำเร็จ</div>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-md border-2 border-blue-200">
            <div className="text-3xl mb-2">⏳</div>
            <div className="text-2xl font-bold text-blue-900">
              {jobs.filter(j => j.status === 'processing').length}
            </div>
            <div className="text-sm text-gray-600">กำลังประมวลผล</div>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-md border-2 border-red-200">
            <div className="text-3xl mb-2">❌</div>
            <div className="text-2xl font-bold text-red-900">
              {jobs.filter(j => j.status === 'failed').length}
            </div>
            <div className="text-sm text-gray-600">ล้มเหลว</div>
          </div>
        </div>

        {/* Jobs Grid */}
        {jobs.length === 0 ? (
          <div className="bg-white rounded-xl p-12 text-center shadow-md">
            <div className="text-6xl mb-4">📭</div>
            <p className="text-xl text-gray-600 mb-4">ยังไม่มีงาน</p>
            <p className="text-gray-500">เริ่มสร้างงานแรกของคุณได้เลย!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="bg-white rounded-xl shadow-lg overflow-hidden hover:shadow-xl transition-shadow border-2 border-purple-100"
              >
                {/* Thumbnail */}
                <div className="aspect-square bg-gray-100 relative">
                  {job.output_urls && job.output_urls.length > 0 && job.output_urls[0] ? (
                    <OptimizedImage
                      url={job.output_urls[0]}
                      alt="Output"
                    />
                  ) : job.image_urls && job.image_urls.length > 0 && job.image_urls[0] ? (
                    <div className="relative w-full h-full">
                      <Image
                        src={job.image_urls[0].includes('cloudinary.com') 
                          ? job.image_urls[0].replace('/upload/', '/upload/f_auto,q_70,w_400,c_fill,fl_progressive/') 
                          : job.image_urls[0]}
                        alt="Input"
                        fill
                        className="object-cover opacity-50"
                        loading="lazy"
                        unoptimized
                        priority={false}
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-4xl">⏳</span>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-6xl">🖼️</span>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="p-4">
                  {/* Status Badge */}
                  <div className="mb-3">
                    {job.status === 'processing' ? (
                      <div className="space-y-2">
                        <span
                          className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold border-2 ${getStatusColor(
                            job.status
                          )}`}
                        >
                          {getStatusIcon(job.status)} PROCESSING
                        </span>
                        {/* Progress Bar */}
                        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                          <div 
                            className="bg-blue-600 h-2 rounded-full transition-all duration-1000 animate-pulse"
                            style={{ width: '60%' }}
                          />
                        </div>
                      </div>
                    ) : (
                      <span
                        className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold border-2 ${getStatusColor(
                          job.status
                        )}`}
                      >
                        {getStatusIcon(job.status)} {job.status.toUpperCase()}
                      </span>
                    )}
                  </div>

                  {/* Mode/Type */}
                  <div className="mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs bg-gradient-to-r from-purple-100 to-pink-100 text-purple-800 px-3 py-1 rounded-full font-semibold border border-purple-200">
                        {job.job_type === 'text-to-image' && '✨ Text to Image'}
                        {job.job_type === 'custom-prompt' && '🎨 Custom Prompt'}
                        {job.job_type === 'custom-prompt-template' && '🎨 Custom + Template'}
                        {job.job_type === 'custom-template' && '🖼️ Custom Template'}
                        {job.job_type === 'gpt-image' && '🎨 GPT Image 1.5'}
                        {job.job_type === 'gpt-with-template' && '🤖 GPT + Template'}
                        {job.job_type === 'upscale' && '🔍 Upscale'}
                        {!job.job_type && '📋 Unknown'}
                      </span>
                      {job.output_size && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full border border-blue-200">
                          📐 {job.output_size}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* User Info */}
                  <div className="text-sm text-gray-700 mb-3 space-y-1 bg-gray-50 p-2 rounded-lg">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">👤</span>
                      <span className="font-semibold">{job.user_name || job.user_email?.split('@')[0] || 'Unknown'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-600">
                      <span>📅</span>
                      <span>{formatDate(job.created_at)}</span>
                    </div>
                    {job.completed_at && (
                      <div className="flex items-center gap-1.5 text-xs text-green-600 font-semibold">
                        <span>⏱️</span>
                        <span>ใช้เวลา {calculateDuration(job.created_at, job.completed_at)}</span>
                      </div>
                    )}
                    {job.image_urls && job.image_urls.length > 0 && (
                      <div className="flex items-center gap-1.5 text-xs text-gray-600">
                        <span>🖼️</span>
                        <span>{job.image_urls.length} รูปอ้างอิง</span>
                      </div>
                    )}
                  </div>

                  {/* Template Preview */}
                  {job.template_url && (
                    <div className="mb-3 bg-gradient-to-br from-indigo-50 to-purple-50 p-3 rounded-lg border-2 border-indigo-200">
                      <div className="text-xs font-semibold text-indigo-800 mb-2 flex items-center gap-1">
                        <span>🎨</span>
                        <span>เทมเพลตที่ใช้:</span>
                      </div>
                      <div className="relative w-full aspect-square rounded-lg overflow-hidden border-2 border-indigo-300">
                        <Image
                          src={job.template_url.includes('cloudinary.com') 
                            ? job.template_url.replace('/upload/', '/upload/f_auto,q_70,w_400,c_limit,fl_progressive/') 
                            : job.template_url}
                          alt="Template"
                          fill
                          className="object-cover"
                          loading="lazy"
                          unoptimized
                        />
                      </div>
                    </div>
                  )}

                  {/* Prompt */}
                  {job.prompt && (
                    <div className="mb-3 bg-purple-50 p-3 rounded-lg border border-purple-100">
                      <div className="text-xs font-semibold text-purple-800 mb-1 flex items-center gap-1">
                        <span>💬</span>
                        <span>Prompt:</span>
                      </div>
                      <p className="text-sm text-gray-700 line-clamp-3">
                        {job.prompt}
                      </p>
                    </div>
                  )}

                  {/* Error Message */}
                  {job.status === 'failed' && job.error && (
                    <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                      ⚠️ {job.error}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="space-y-2">
                    {job.output_urls && job.output_urls.length > 0 && (
                      <>
                        <button
                          onClick={() => handleViewImages(job)}
                          className="w-full bg-purple-600 hover:bg-purple-700 text-white py-2 rounded-lg font-semibold transition-colors"
                        >
                          👁️ ดูรูปทั้งหมด ({job.output_urls.length})
                        </button>
                        {job.status === 'completed' && (
                          <button
                            onClick={() => handleEditWithGemini(job.output_urls[0])}
                            className="w-full bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white py-2 rounded-lg font-semibold transition-all transform hover:scale-105"
                          >
                            ✨ แก้ไขด้วย Gemini
                          </button>
                        )}
                      </>
                    )}
                    <button
                      onClick={() => handleDeleteJob(job.id)}
                      disabled={deleting === job.id}
                      className="w-full bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {deleting === job.id ? '⏳ กำลังลบ...' : '🗑️ ลบงาน'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && selectedJob && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-purple-900">
                  รูปทั้งหมด ({selectedJob.output_urls?.length || 0} รูป)
                </h2>
                {selectedJob.prompt && (
                  <p className="text-sm text-gray-600 mt-1">
                    💬 {selectedJob.prompt}
                  </p>
                )}
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-4xl text-gray-400 hover:text-gray-600 transition-colors"
              >
                ×
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6">
              {/* Job Details */}
              <div className="mb-6 bg-gradient-to-r from-purple-50 to-blue-50 p-4 rounded-lg border border-purple-200">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-xs text-gray-600 mb-1">โหมด:</div>
                    <div className="font-semibold text-purple-900">
                      {selectedJob.job_type === 'text-to-image' && '✨ Text to Image'}
                      {selectedJob.job_type === 'custom-prompt' && '🎨 Custom Prompt'}
                      {selectedJob.job_type === 'custom-prompt-template' && '🎨 Custom + Template'}
                      {selectedJob.job_type === 'custom-template' && '🖼️ Custom Template'}
                      {selectedJob.job_type === 'gpt-image' && '🎨 GPT Image 1.5'}
                      {selectedJob.job_type === 'gpt-with-template' && '🤖 GPT + Template'}
                      {selectedJob.job_type === 'upscale' && '🔍 Upscale'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-600 mb-1">ผู้สร้าง:</div>
                    <div className="font-semibold text-purple-900">
                      {selectedJob.user_name || selectedJob.user_email?.split('@')[0]}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-600 mb-1">วันที่สร้าง:</div>
                    <div className="font-semibold text-purple-900">
                      {formatDate(selectedJob.created_at)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-600 mb-1">ขนาด:</div>
                    <div className="font-semibold text-purple-900">
                      {selectedJob.output_size || 'N/A'}
                    </div>
                  </div>
                </div>
                
                {/* Processing Duration */}
                {selectedJob.completed_at && (
                  <div className="mt-3 pt-3 border-t border-purple-200">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-xs text-gray-600">⏱️ ระยะเวลาประมวลผล:</span>
                      <span className="font-semibold text-green-600">
                        {calculateDuration(selectedJob.created_at, selectedJob.completed_at)}
                      </span>
                    </div>
                  </div>
                )}
                
                {/* Template Preview */}
                {selectedJob.template_url && (
                  <div className="mt-3 pt-3 border-t border-purple-200">
                    <div className="text-xs font-semibold text-gray-700 mb-2">🎨 เทมเพลตที่ใช้:</div>
                    <div className="w-32 h-32 relative rounded-lg overflow-hidden border-2 border-indigo-300">
                      <Image
                        src={selectedJob.template_url.includes('cloudinary.com') 
                          ? selectedJob.template_url.replace('/upload/', '/upload/f_auto,q_70,w_300,c_limit,fl_progressive/') 
                          : selectedJob.template_url}
                        alt="Template"
                        fill
                        className="object-cover"
                        loading="lazy"
                        unoptimized
                      />
                    </div>
                  </div>
                )}
                
                {/* Input Images Preview */}
                {selectedJob.image_urls && selectedJob.image_urls.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-purple-200">
                    <div className="text-xs font-semibold text-gray-700 mb-2">🖼️ รูปอ้างอิง ({selectedJob.image_urls.length} รูป):</div>
                    <div className="flex gap-2 overflow-x-auto">
                      {selectedJob.image_urls.slice(0, 5).map((url, index) => (
                        <div key={index} className="flex-shrink-0 w-16 h-16 relative rounded border border-purple-300">
                          <Image
                            src={url}
                            alt={`Input ${index + 1}`}
                            fill
                            className="object-cover rounded"
                            unoptimized
                          />
                        </div>
                      ))}
                      {selectedJob.image_urls.length > 5 && (
                        <div className="flex-shrink-0 w-16 h-16 bg-purple-100 rounded border border-purple-300 flex items-center justify-center text-xs text-purple-700 font-semibold">
                          +{selectedJob.image_urls.length - 5}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Output Images Grid */}
              <div>
                {selectedJob._originalCount && selectedJob._originalCount > 0 ? (
                  <>
                    {/* Original Images */}
                    <div className="mb-8">
                      <h3 className="text-lg font-semibold text-gray-800 mb-3">
                        📸 รูปต้นฉบับ ({selectedJob._originalCount} รูป)
                      </h3>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {selectedJob.output_urls?.slice(0, selectedJob._originalCount).map((url, index) => (
                          url ? (
                            <div
                              key={index}
                              className="aspect-square relative rounded-lg overflow-hidden border-2 border-purple-200 hover:border-purple-400 transition-colors group"
                            >
                              <Image
                                src={url.includes('cloudinary.com') 
                                  ? url.replace('/upload/', '/upload/f_auto,q_70,w_1200,c_limit,fl_progressive/') 
                                  : url}
                                alt={`Original ${index + 1}`}
                                fill
                                className="object-cover"
                                loading="lazy"
                                unoptimized
                              />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="absolute top-2 right-2 bg-white/90 hover:bg-white text-purple-600 rounded-full p-2 shadow-lg transition-all opacity-0 group-hover:opacity-100"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              </a>
                            </div>
                          ) : null
                        ))}
                      </div>
                    </div>

                    {/* Upscaled Images */}
                    {selectedJob.output_urls?.length > selectedJob._originalCount && (
                      <div>
                        <h3 className="text-lg font-semibold text-gray-800 mb-3">
                          🔍 รูปที่อัพสเกล x2 ({selectedJob.output_urls.length - selectedJob._originalCount} รูป)
                          <span className="ml-2 text-sm text-green-600">
                            (ความละเอียดสูงขึ้น 2 เท่า)
                          </span>
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                          {selectedJob.output_urls?.slice(selectedJob._originalCount).map((url, index) => (
                            url ? (
                              <div
                                key={index}
                                className="aspect-square relative rounded-lg overflow-hidden border-2 border-green-200 hover:border-green-400 transition-colors group"
                              >
                                <div className="absolute top-2 left-2 bg-green-500 text-white text-xs px-2 py-1 rounded-full font-semibold shadow-lg z-10">
                                  🔍 Upscaled
                                </div>
                                <Image
                                  src={url.includes('cloudinary.com') 
                                    ? url.replace('/upload/', '/upload/f_auto,q_70,w_1200,c_limit,fl_progressive/') 
                                    : url}
                                  alt={`Upscaled ${index + 1}`}
                                  fill
                                  className="object-cover"
                                  loading="lazy"
                                  unoptimized
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="absolute top-2 right-2 bg-white/90 hover:bg-white text-green-600 rounded-full p-2 shadow-lg transition-all opacity-0 group-hover:opacity-100"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                </a>
                              </div>
                            ) : null
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  /* ถ้าไม่มีข้อมูล _originalCount แสดงแบบเดิม */
                  <>
                    <h3 className="text-lg font-semibold text-gray-800 mb-3">
                      📸 ผลลัพธ์ ({selectedJob.output_urls?.length || 0} รูป)
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {selectedJob.output_urls?.map((url, index) => (
                        url ? (
                          <div
                            key={index}
                            className="aspect-square relative rounded-lg overflow-hidden border-2 border-purple-200 hover:border-purple-400 transition-colors group"
                          >
                            <Image
                              src={url.includes('cloudinary.com') 
                                ? url.replace('/upload/', '/upload/f_auto,q_70,w_1200,c_limit,fl_progressive/') 
                                : url}
                              alt={`Output ${index + 1}`}
                              fill
                              className="object-cover"
                              loading="lazy"
                              unoptimized
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="absolute top-2 right-2 bg-white/90 hover:bg-white text-purple-600 rounded-full p-2 shadow-lg transition-all opacity-0 group-hover:opacity-100"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </a>
                            <div className="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                              #{index + 1}
                            </div>
                          </div>
                        ) : null
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
