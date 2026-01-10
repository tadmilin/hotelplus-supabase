import { v2 as cloudinary } from 'cloudinary'

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

export async function uploadToCloudinary(imageUrl: string, folder: string = 'hotelplus') {
  try {
    const result = await cloudinary.uploader.upload(imageUrl, {
      folder,
      resource_type: 'image',
      // Resize to max 1024px to fit in GPU memory (for Replicate)
      transformation: [
        { width: 1024, height: 1024, crop: "limit" }
      ]
    })
    return result.secure_url
  } catch (error) {
    console.error('Cloudinary upload error:', error)
    throw error
  }
}

export async function uploadBase64ToCloudinary(base64Data: string, folder: string = 'hotelplus') {
  try {
    const result = await cloudinary.uploader.upload(base64Data, {
      folder,
      resource_type: 'image',
      // Resize to max 1024px to fit in GPU memory (for Replicate)
      transformation: [
        { width: 1024, height: 1024, crop: "limit" }
      ]
    })
    return result.secure_url
  } catch (error) {
    console.error('Cloudinary upload error:', error)
    throw error
  }
}

// สำหรับรูปที่ต้องการขนาดเต็ม (เช่น ก่อน upscale)
export async function uploadImageFullSize(base64Data: string, folder: string = 'hotelplus') {
  try {
    const result = await cloudinary.uploader.upload(base64Data, {
      folder,
      resource_type: 'image',
      // ไม่มี transformation = เก็บขนาดเต็ม
    })
    return result.secure_url
  } catch (error) {
    console.error('Cloudinary upload error:', error)
    throw error
  }
}

// Alias สำหรับใช้งานง่าย
export const uploadImage = uploadBase64ToCloudinary

export default cloudinary
