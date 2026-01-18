/**
 * Google Apps Script for HotelPlus Jobs Export
 * 
 * Setup:
 * 1. เปิด Google Spreadsheet
 * 2. Extensions → Apps Script
 * 3. วาง code นี้แทนที่ Code.gs
 * 4. Deploy → New deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Copy Web app URL และใส่ใน GOOGLE_SHEETS_WEBHOOK_URL ที่ Vercel
 */

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents)
    
    // Get active spreadsheet
    const ss = SpreadsheetApp.getActiveSpreadsheet()
    let sheet = ss.getSheetByName('Jobs Export')
    
    // Create sheet if not exists
    if (!sheet) {
      sheet = ss.insertSheet('Jobs Export')
      
      // Add headers
      const headers = [
        'Job ID', 'User Name', 'User Email', 'Job Type', 'Status',
        'Prompt', 'Template Type', 'Output Size', 'Input Images', 'Output Images',
        'Created At', 'Completed At', 'Duration (min)', 'Replicate ID', 'Error'
      ]
      
      sheet.appendRow(headers)
      
      // Format header row
      const headerRange = sheet.getRange(1, 1, 1, headers.length)
      headerRange.setBackground('#3399ff')
      headerRange.setFontColor('#ffffff')
      headerRange.setFontWeight('bold')
      sheet.setFrozenRows(1)
    }
    
    // Append data row
    const row = [
      data.jobId,
      data.userName,
      data.userEmail,
      data.jobType,
      data.status,
      data.prompt,
      data.templateType,
      data.outputSize,
      data.inputCount,
      data.outputCount,
      data.createdAt,
      data.completedAt,
      data.duration,
      data.replicateId,
      data.error
    ]
    
    sheet.appendRow(row)
    
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: 'Job exported successfully'
    })).setMimeType(ContentService.MimeType.JSON)
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON)
  }
}

// Test function (เรียกได้จาก Apps Script Editor)
function testDoPost() {
  const testData = {
    postData: {
      contents: JSON.stringify({
        jobId: 'test-123',
        userName: 'Test User',
        userEmail: 'test@example.com',
        jobType: 'text-to-image',
        status: 'completed',
        prompt: 'Test prompt',
        templateType: '',
        outputSize: 'x2',
        inputCount: 1,
        outputCount: 2,
        createdAt: '19/1/2026 15:30:00',
        completedAt: '19/1/2026 15:32:00',
        duration: 2,
        replicateId: 'rep-123',
        error: ''
      })
    }
  }
  
  const result = doPost(testData)
  Logger.log(result.getContent())
}
