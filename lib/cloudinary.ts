import { v2 as cloudinary } from 'cloudinary'
import { Readable } from 'stream'

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

// 🔥 NEW: Stream-based upload (ไม่ต้องแปลง Base64 = ประหยัด memory 33%)
export async function uploadBufferToCloudinary(
  buffer: Buffer,
  options: {
    folder?: string
    publicId?: string
    quality?: string
    transformation?: Record<string, unknown>[]
  } = {}
): Promise<{ secure_url: string; public_id: string }> {
  const maxRetries = 2
  const { 
    folder = 'hotelplus-v2', 
    publicId,
    quality = 'auto:good',
    transformation
  } = options

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        const uploadOptions: Record<string, unknown> = {
          folder,
          resource_type: 'image',
          quality,
          fetch_format: 'auto',
          timeout: 60000,
        }

        if (publicId) uploadOptions.public_id = publicId
        if (transformation) uploadOptions.transformation = transformation

        const uploadStream = cloudinary.uploader.upload_stream(
          uploadOptions,
          (error, result) => {
            if (error) {
              reject(error)
            } else if (result) {
              resolve({
                secure_url: result.secure_url,
                public_id: result.public_id,
              })
            } else {
              reject(new Error('Upload result is undefined'))
            }
          }
        )

        // Pipe buffer to upload stream
        Readable.from(buffer).pipe(uploadStream)
      })
    } catch (error) {
      const isLastAttempt = attempt === maxRetries

      if (isLastAttempt) {
        console.error('Cloudinary stream upload error:', error)
        throw error
      }

      const backoffMs = 2000 * attempt
      console.log(`⚠️ Stream upload attempt ${attempt} failed, retrying in ${backoffMs}ms...`)
      await new Promise(resolve => setTimeout(resolve, backoffMs))
    }
  }

  throw new Error('Stream upload failed after retries')
}

export async function uploadToCloudinary(imageUrl: string, folder: string = 'hotelplus') {
  try {
    const result = await cloudinary.uploader.upload(imageUrl, {
      folder,
      resource_type: 'image',
      quality: 'auto:good', // Optimize: ใช้ good แทน best
      fetch_format: 'auto',
      transformation: [
        { width: 1440, height: 1440, crop: "limit" }
      ]
    })
    return result.secure_url
  } catch (error) {
    console.error('Cloudinary upload error:', error)
    throw error
  }
}

// 🔥 สำหรับรูปที่จะส่งไป Replicate - ไม่ resize เพื่อรักษาคุณภาพหน้าคน
// Nano Banana Pro ต้องการรูปที่มีความละเอียดสูงเพื่อ detect หน้าได้ดี
export async function uploadToCloudinaryForReplicate(imageUrl: string, folder: string = 'hotelplus-replicate') {
  try {
    const result = await cloudinary.uploader.upload(imageUrl, {
      folder,
      resource_type: 'image',
      // 🔥 Optimize: ลด quality และ resize เล็กน้อย (ประหยัด credits)
      quality: 'auto:good', // เปลี่ยนจาก auto:best → auto:good (ประหยัด ~30%)
      fetch_format: 'auto',
      transformation: [
        { width: 2048, height: 2048, crop: "limit" } // จำกัดขนาดสูงสุด 2K (เพียงพอสำหรับ AI)
      ]
    })
    return result.secure_url
  } catch (error) {
    console.error('Cloudinary upload error:', error)
    throw error
  }
}

// สำหรับ upscaled images - เก็บขนาดเต็ม (แต่ optimize format)
export async function uploadToCloudinaryFullSize(imageUrl: string, folder: string = 'hotelplus') {
  const maxRetries = 2
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await cloudinary.uploader.upload(imageUrl, {
        folder,
        resource_type: 'image',
        quality: 'auto:good', // 🔥 Consistent optimization
        fetch_format: 'auto', // 🔥 Auto WebP
        timeout: 60000, // 60 seconds
      })
      return result.secure_url
    } catch (error) {
      const isLastAttempt = attempt === maxRetries
      
      if (isLastAttempt) {
        console.error('Cloudinary upload error (full-size):', error)
        throw error
      }
      
      const backoffMs = 2000 * attempt
      console.log(`⚠️ Cloudinary upload attempt ${attempt} failed, retrying in ${backoffMs}ms...`)
      await new Promise(resolve => setTimeout(resolve, backoffMs))
    }
  }
  
  throw new Error('Upload failed after retries')
}

export async function uploadBase64ToCloudinary(base64Data: string, folder: string = 'hotelplus') {
  const maxRetries = 2
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await cloudinary.uploader.upload(base64Data, {
        folder,
        resource_type: 'image',
        format: 'jpg',
        quality: 'auto:good', // 🔥 Consistent optimization
        transformation: [
          { width: 1440, height: 1440, crop: "limit" }
        ],
        timeout: 60000,
      })
      return result.secure_url
    } catch (error) {
      const isLastAttempt = attempt === maxRetries
      
      if (isLastAttempt) {
        console.error('Cloudinary upload error (base64):', error)
        throw error
      }
      
      const backoffMs = 2000 * attempt
      console.log(`⚠️ Cloudinary upload attempt ${attempt} failed, retrying in ${backoffMs}ms...`)
      await new Promise(resolve => setTimeout(resolve, backoffMs))
    }
  }
  
  throw new Error('Upload failed after retries')
}

// สำหรับรูปที่ต้องการขนาดเต็ม (เช่น ก่อน upscale)
export async function uploadImageFullSize(base64Data: string, folder: string = 'hotelplus') {
  const maxRetries = 2
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await cloudinary.uploader.upload(base64Data, {
        folder,
        resource_type: 'image',
        quality: 'auto:good', // 🔥 Consistent optimization
        fetch_format: 'auto', // 🔥 Auto WebP
        timeout: 60000,
      })
      return result.secure_url
    } catch (error) {
      const isLastAttempt = attempt === maxRetries
      
      if (isLastAttempt) {
        console.error('Cloudinary upload error (image full-size):', error)
        throw error
      }
      
      const backoffMs = 2000 * attempt
      console.log(`⚠️ Cloudinary upload attempt ${attempt} failed, retrying in ${backoffMs}ms...`)
      await new Promise(resolve => setTimeout(resolve, backoffMs))
    }
  }
  
  throw new Error('Upload failed after retries')
}

// Alias สำหรับใช้งานง่าย
export const uploadImage = uploadBase64ToCloudinary

// 🔥 Aspect Ratio Mapping: User ratio → GPT supported ratio
// GPT Image 1.5 รองรับแค่: 1:1, 3:2, 2:3
export const ASPECT_RATIO_MAP: Record<string, { gptRatio: string; cropRatio: number }> = {
  '1:1': { gptRatio: '1:1', cropRatio: 1 },
  '16:9': { gptRatio: '3:2', cropRatio: 16/9 },  // Generate 3:2, crop to 16:9
  '9:16': { gptRatio: '2:3', cropRatio: 9/16 },  // Generate 2:3, crop to 9:16
  '4:3': { gptRatio: '1:1', cropRatio: 4/3 },    // Generate 1:1, crop to 4:3
  '3:4': { gptRatio: '1:1', cropRatio: 3/4 },    // Generate 1:1, crop to 3:4
  '3:2': { gptRatio: '3:2', cropRatio: 3/2 },    // Native support
  '2:3': { gptRatio: '2:3', cropRatio: 2/3 },    // Native support
}

// 🔥 Upload และ Crop ไปยัง aspect ratio ที่ต้องการ
export async function uploadAndCropToAspectRatio(
  imageUrl: string, 
  targetAspectRatio: string,
  folder: string = 'hotelplus'
): Promise<string> {
  const maxRetries = 2
  
  // Parse target ratio
  const [w, h] = targetAspectRatio.split(':').map(Number)
  if (!w || !h) {
    console.log('⚠️ Invalid aspect ratio, uploading without crop')
    return uploadToCloudinaryFullSize(imageUrl, folder)
  }
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await cloudinary.uploader.upload(imageUrl, {
        folder,
        resource_type: 'image',
        timeout: 60000,
        transformation: [
          { 
            aspect_ratio: `${w}:${h}`,
            crop: 'fill',        // Fill to exact ratio, may crop edges
            gravity: 'center',   // Center the crop
            quality: 'auto:good', // 🔥 Consistent optimization
            fetch_format: 'auto', // 🔥 Auto WebP
          }
        ],
      })
      console.log(`✅ Cropped to ${targetAspectRatio}: ${result.secure_url}`)
      return result.secure_url
    } catch (error) {
      const isLastAttempt = attempt === maxRetries
      
      if (isLastAttempt) {
        console.error('Cloudinary crop error:', error)
        // Fallback: upload without crop
        console.log('⚠️ Crop failed, uploading without transformation')
        return uploadToCloudinaryFullSize(imageUrl, folder)
      }
      
      const backoffMs = 2000 * attempt
      console.log(`⚠️ Cloudinary crop attempt ${attempt} failed, retrying in ${backoffMs}ms...`)
      await new Promise(resolve => setTimeout(resolve, backoffMs))
    }
  }
  
  throw new Error('Crop failed after retries')
}

export default cloudinary
