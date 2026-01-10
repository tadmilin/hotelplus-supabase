"use client";

import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";

interface ChatMessage {
  role: "user" | "model";
  parts: Array<{
    text?: string;
    inlineData?: {
      mimeType: string;
      data: string;
    };
  }>;
}

export default function GeminiEditPage() {
  const searchParams = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
    });
  }, []);

  // โหลดรูปจาก URL parameter (จาก Dashboard)
  useEffect(() => {
    const imageUrl = searchParams.get("imageUrl");
    if (imageUrl && isInitialLoad) {
      setIsInitialLoad(false);
      
      // แปลง URL เป็น base64 สำหรับส่งไป Gemini
      fetch(imageUrl)
        .then((res) => res.blob())
        .then((blob) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = reader.result as string;
            setSelectedImage(base64);
            setMessage("แก้ไขรูปนี้ให้สวยงามขึ้น"); // Default prompt
          };
          reader.readAsDataURL(blob);
        })
        .catch((err) => {
          console.error("Error loading image:", err);
          alert("ไม่สามารถโหลดรูปได้ กรุณาลองใหม่อีกครั้ง");
        });
    }
  }, [searchParams, isInitialLoad]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setSelectedImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSend = async () => {
    if (!message.trim() && !selectedImage) return;
    if (!user) {
      alert("Please login first");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          message: message.trim(),
          imageBase64: selectedImage,
          history,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

      const data = await response.json();

      setConversationId(data.conversationId);
      setHistory(data.history);
      
      // แสดงรูปที่ได้จาก API (ถ้ามี)
      if (data.images && data.images.length > 0) {
        console.log("Generated images:", data.images);
      }
      
      setMessage("");
      setSelectedImage(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      console.error("Error sending message:", error);
      alert("Failed to send message. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewConversation = () => {
    setConversationId(null);
    setHistory([]);
    setMessage("");
    setSelectedImage(null);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                ✨ Gemini Edit
              </h1>
              <p className="text-gray-600 mt-1">
                แก้ไขรูปภาพแบบ Conversational - อัพโหลดรูปและพูดคุยกับ AI
              </p>
            </div>
            <button
              onClick={handleNewConversation}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
            >
              🆕 New Chat
            </button>
          </div>
        </div>

        {/* Chat Container */}
        <div className="bg-white rounded-lg shadow-sm flex flex-col" style={{ height: "calc(100vh - 250px)" }}>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {history.length === 0 ? (
              <div className="text-center text-gray-500 mt-20">
                <div className="text-6xl mb-4">💬</div>
                <p className="text-xl font-semibold mb-2">
                  เริ่มต้นการสนทนา
                </p>
                <p className="text-sm">
                  อัพโหลดรูปและพิมพ์ข้อความเพื่อเริ่มแก้ไขรูปภาพ
                </p>
              </div>
            ) : (
              history.map((msg, index) => (
                <div
                  key={index}
                  className={`flex ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[70%] rounded-lg p-4 ${
                      msg.role === "user"
                        ? "bg-blue-500 text-white"
                        : "bg-gray-100 text-gray-900"
                    }`}
                  >
                    {msg.parts.map((part, partIndex) => (
                      <div key={partIndex}>
                        {part.inlineData && (
                          <img
                            src={
                              part.inlineData.data.startsWith("http")
                                ? part.inlineData.data
                                : `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
                            }
                            alt={msg.role === "user" ? "Uploaded" : "Generated by Gemini"}
                            className="rounded-lg mb-2 max-w-full"
                          />
                        )}
                        {part.text && (
                          <p className="whitespace-pre-wrap">{part.text}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 text-gray-900 rounded-lg p-4">
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input Area */}
          <div className="border-t p-4">
            {selectedImage && (
              <div className="mb-2 relative inline-block">
                <img
                  src={selectedImage}
                  alt="Selected"
                  className="h-20 rounded-lg border"
                />
                <button
                  onClick={() => setSelectedImage(null)}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600"
                >
                  ×
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
                disabled={isLoading}
              >
                📎
              </button>
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="พิมพ์ข้อความ... (Enter เพื่อส่ง)"
                className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                disabled={isLoading}
              />
              <button
                onClick={handleSend}
                disabled={isLoading || (!message.trim() && !selectedImage)}
                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {isLoading ? "⏳" : "📤"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
