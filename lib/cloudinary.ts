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
      // Resize to ~1440p for better face detail
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
      // 🔥 ไม่ resize - รักษาขนาดเต็มเพื่อให้ AI detect หน้าได้ดีขึ้น
      // ถ้ารูปใหญ่มาก Replicate จะ handle เอง
      quality: 'auto:best', // รักษาคุณภาพสูงสุด
      fetch_format: 'auto', // ให้ Cloudinary เลือก format ที่ดีที่สุด
    })
    return result.secure_url
  } catch (error) {
    console.error('Cloudinary upload error:', error)
    throw error
  }
}

// สำหรับ upscaled images - เก็บขนาดเต็ม
export async function uploadToCloudinaryFullSize(imageUrl: string, folder: string = 'hotelplus') {
  try {
    const result = await cloudinary.uploader.upload(imageUrl, {
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

export async function uploadBase64ToCloudinary(base64Data: string, folder: string = 'hotelplus') {
  try {
    const result = await cloudinary.uploader.upload(base64Data, {
      folder,
      resource_type: 'image',
      format: 'jpg', // บังคับแปลงเป็น JPEG (รองรับทุก format รวม HEIC)
      // Resize to ~1440p (2560x1440) for better quality (ใกล้ max ของ Real-ESRGAN)
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
