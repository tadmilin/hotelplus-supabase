import { GoogleGenAI } from "@google/genai";

if (!process.env.GOOGLE_AI_API_KEY) {
  console.warn("⚠️ GOOGLE_AI_API_KEY is not set in environment variables");
}

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_AI_API_KEY || "",
});

export interface ChatMessage {
  role: "user" | "model";
  parts: Array<{
    text?: string;
    inlineData?: {
      mimeType: string;
      data: string; // base64
    };
  }>;
}

export interface GeminiChatOptions {
  model?: string;
  history?: ChatMessage[];
}

/**
 * สร้าง chat session ใหม่พร้อม image generation
 */
export async function createGeminiChat(options: GeminiChatOptions = {}) {
  const chat = ai.chats.create({
    model: options.model || "gemini-2.5-flash-image",
    config: {
      responseModalities: ["TEXT", "IMAGE"],
    },
    history: options.history,
  });

  return chat;
}

/**
 * ส่งข้อความและรูปภาพไปยัง Gemini แล้วรับรูปกลับมา
 */
export async function sendMessage(
  chat: any,
  message: string,
  imageBase64?: string
) {
  const parts: any[] = [];

  // เพิ่มข้อความ
  if (message) {
    parts.push({ text: message });
  }

  // เพิ่มรูปภาพถ้ามี
  if (imageBase64) {
    // ลบ data:image/...;base64, prefix ถ้ามี
    const base64Data = imageBase64.includes(",")
      ? imageBase64.split(",")[1]
      : imageBase64;

    parts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: base64Data,
      },
    });
  }

  const response = await chat.sendMessage({ message: parts });

  // Extract text และ images จาก response
  let responseText = "";
  const generatedImages: string[] = [];

  if (response.candidates && response.candidates[0]) {
    for (const part of response.candidates[0].content.parts) {
      if (part.text) {
        responseText += part.text;
      } else if (part.inlineData) {
        // รูปที่ Gemini generate มา (base64)
        generatedImages.push(part.inlineData.data);
      }
    }
  }

  return {
    text: responseText,
    images: generatedImages, // Array of base64 images
  };
}

/**
 * แปลงรูปภาพเป็น base64 (ไม่ใช้แล้ว - เก็บไว้สำหรับอนาคต)
 */
export async function imageUrlToBase64(imageUrl: string): Promise<string> {
  const response = await fetch(imageUrl);
  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  return base64;
}
