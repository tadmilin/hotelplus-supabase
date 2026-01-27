'use client'

import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'
import { User } from '@supabase/supabase-js'

export default function Navbar() {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function getUser() {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      setLoading(false)
    }
    getUser()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [supabase])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (pathname === '/login' || pathname === '/register') {
    return null
  }

  return (
    <nav className="bg-gradient-to-r from-gray-900 to-black text-white shadow-lg">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="text-2xl font-bold hover:opacity-80 transition-opacity">
              🏨 HotelPlus AI
            </Link>
            
            {user && (
              <div className="hidden md:flex gap-4">
                <Link 
                  href="/dashboard"
                  className={`px-4 py-2 rounded-lg transition-all ${
                    pathname === '/dashboard' 
                      ? 'bg-white text-gray-900 font-semibold' 
                      : 'hover:bg-gray-700'
                  }`}
                >
                  📊 Dashboard
                </Link>
                <Link 
                  href="/text-to-image"
                  className={`px-4 py-2 rounded-lg transition-all ${
                    pathname === '/text-to-image' 
                      ? 'bg-white text-gray-900 font-semibold' 
                      : 'hover:bg-gray-700'
                  }`}
                >
                  ✨ Text to Image
                </Link>
                <Link 
                  href="/custom-prompt"
                  className={`px-4 py-2 rounded-lg transition-all ${
                    pathname === '/custom-prompt' 
                      ? 'bg-white text-gray-900 font-semibold' 
                      : 'hover:bg-gray-700'
                  }`}
                >
                  🎨 Custom Prompt
                </Link>
                <Link 
                  href="/gpt-image"
                  className={`px-4 py-2 rounded-lg transition-all ${
                    pathname === '/gpt-image' 
                      ? 'bg-white text-gray-900 font-semibold' 
                      : 'hover:bg-gray-700'
                  }`}
                >
                  🎨 GPT Image
                </Link>
                <Link 
                  href="/freepik"
                  className={`px-4 py-2 rounded-lg transition-all ${
                    pathname === '/freepik' 
                      ? 'bg-white text-gray-900 font-semibold' 
                      : 'hover:bg-gray-700'
                  }`}
                >
                  🌟 Freepik AI
                </Link>
                <Link 
                  href="/upscale"
                  className={`px-4 py-2 rounded-lg transition-all ${
                    pathname === '/upscale' 
                      ? 'bg-white text-gray-900 font-semibold' 
                      : 'hover:bg-gray-700'
                  }`}
                >
                  🔍 Upscale
                </Link>
                <Link 
                  href="/gemini-edit"
                  className={`px-4 py-2 rounded-lg transition-all ${
                    pathname === '/gemini-edit' 
                      ? 'bg-white text-gray-900 font-semibold' 
                      : 'hover:bg-gray-700'
                  }`}
                >
                  💬 Gemini Edit
                </Link>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            {loading ? (
              <div className="text-sm">Loading...</div>
            ) : user ? (
              <>
                <div className="text-sm">
                  <div className="font-semibold">{user.email}</div>
                </div>
                <button
                  onClick={handleLogout}
                  className="px-4 py-2 bg-red-500 hover:bg-red-600 rounded-lg font-semibold transition-colors"
                >
                  🚪 Logout
                </button>
              </>
            ) : (
              <Link 
                href="/login"
                className="px-4 py-2 bg-white text-gray-900 hover:bg-gray-200 rounded-lg font-semibold transition-colors"
              >
                🔑 Login
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
