import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createGeminiChat, sendMessage, ChatMessage } from "@/lib/gemini";
import { uploadImage } from "@/lib/cloudinary";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    // ตรวจสอบ authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { conversationId, message, imageBase64, history } = body;

    if (!message && !imageBase64) {
      return NextResponse.json(
        { error: "Message or image is required" },
        { status: 400 }
      );
    }

    // สร้าง chat session
    const chat = await createGeminiChat({
      history: history || [],
    });

    // ส่งข้อความไปยัง Gemini
    const response = await sendMessage(chat, message, imageBase64);

    // อัพโหลดรูปที่ได้ไปยัง Cloudinary (ถ้ามี)
    const generatedImageUrls: string[] = [];
    if (response.images && response.images.length > 0) {
      for (const base64Image of response.images) {
        try {
          // ใช้ uploadImage จาก lib/cloudinary.ts ที่มี config แล้ว
          const dataUrl = `data:image/png;base64,${base64Image}`;
          const cloudinaryUrl = await uploadImage(dataUrl, "gemini-generated");
          generatedImageUrls.push(cloudinaryUrl);
        } catch (uploadError) {
          console.error("Error uploading to Cloudinary:", uploadError);
          // เก็บเป็น base64 ถ้า upload ไม่สำเร็จ (fallback)
          generatedImageUrls.push(`data:image/png;base64,${base64Image}`);
        }
      }
    }

    // สร้าง updated history
    const updatedHistory: ChatMessage[] = [
      ...(history || []),
      {
        role: "user",
        parts: [
          ...(imageBase64
            ? [
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: imageBase64.includes(",")
                      ? imageBase64.split(",")[1]
                      : imageBase64,
                  },
                },
              ]
            : []),
          ...(message ? [{ text: message }] : []),
        ],
      },
      {
        role: "model",
        parts: [
          { text: response.text },
          // เพิ่มรูปที่ generate ได้ลงใน history
          ...generatedImageUrls.map((url) => ({
            inlineData: {
              mimeType: "image/png",
              data: url.startsWith("data:") ? url.split(",")[1] : url, // ถ้าเป็น URL ใช้ URL, ถ้าเป็น base64 ใช้ base64
            },
          })),
        ],
      },
    ];

    // บันทึกหรืออัพเดท conversation
    if (conversationId) {
      // อัพเดท conversation เดิม
      const { error: updateError } = await supabase
        .from("gemini_conversations")
        .update({
          history: updatedHistory,
        })
        .eq("id", conversationId)
        .eq("user_id", user.id);

      if (updateError) {
        console.error("Error updating conversation:", updateError);
        return NextResponse.json(
          { error: "Failed to update conversation" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        conversationId,
        response: response.text,
        images: generatedImageUrls,
        history: updatedHistory,
      });
    } else {
      // สร้าง conversation ใหม่
      const title =
        message?.substring(0, 50) || "New Conversation";

      const { data: conversation, error: insertError } = await supabase
        .from("gemini_conversations")
        .insert({
          user_id: user.id,
          title,
          history: updatedHistory,
        })
        .select()
        .single();

      if (insertError) {
        console.error("Error creating conversation:", insertError);
        return NextResponse.json(
          { error: "Failed to create conversation" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        conversationId: conversation.id,
        response: response.text,
        images: generatedImageUrls,
        history: updatedHistory,
      });
    }
  } catch (error: any) {
    console.error("Error in Gemini chat:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
