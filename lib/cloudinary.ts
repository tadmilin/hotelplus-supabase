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
    })
    return result.secure_url
  } catch (error) {
    console.error('Cloudinary upload error:', error)
    throw error
  }
}

export default cloudinary
