#!/usr/bin/env node

// Sync Google Shared Drives to Database
// Usage: node scripts/sync-drives.js

import 'dotenv/config'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function syncDrives() {
  console.log('🔄 Starting Google Drives sync...\n')

  try {
    // 1. Initialize Google Drive API
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: (process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY).replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    })

    const drive = google.drive({ version: 'v3', auth })

    // 2. Fetch all Shared Drives from Google
    console.log('📡 Fetching drives from Google API...')
    const response = await drive.drives.list({ pageSize: 100 })
    const drives = response.data.drives || []
    
    console.log(`✅ Found ${drives.length} drives\n`)

    if (drives.length === 0) {
      console.log('⚠️  No drives found. Make sure Service Account has access to Shared Drives.')
      return
    }

    // 3. Clear old data and insert new data
    console.log('💾 Updating database...')
    
    // Delete all old drives
    const { error: deleteError } = await supabase
      .from('google_drives')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000') // Delete all

    if (deleteError) {
      console.error('❌ Error clearing old drives:', deleteError)
      return
    }

    // Insert new drives
    const driveData = drives.map(drive => ({
      drive_id: drive.id,
      drive_name: drive.name,
      synced_at: new Date().toISOString()
    }))

    const { error: insertError } = await supabase
      .from('google_drives')
      .insert(driveData)

    if (insertError) {
      console.error('❌ Error inserting drives:', insertError)
      return
    }

    // 4. Display results
    console.log('\n✅ Sync completed successfully!\n')
    console.log('📊 Synced drives:')
    drives.forEach((drive, index) => {
      console.log(`   ${index + 1}. ${drive.name} (${drive.id})`)
    })

    console.log('\n💡 Users can now select drives from the synced list.')
    console.log('⚡ Loading will be 100x faster!\n')

  } catch (error) {
    console.error('❌ Sync failed:', error)
    process.exit(1)
  }
}

syncDrives()
