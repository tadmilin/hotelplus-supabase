/**
 * Freepik API Client
 * 
 * Production-ready implementation for:
 * - Image to Prompt
 * - Improve Prompt  
 * - Mystic/Seedream Image Generation
 * 
 * @see https://docs.freepik.com/
 */

const FREEPIK_API_BASE = 'https://api.freepik.com/v1/ai'

// Types
export interface FreepikTaskResponse {
  data: {
    task_id: string
    status: 'CREATED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
    generated?: string[]
    has_nsfw?: boolean[]
  }
}

export interface FreepikErrorResponse {
  message: string
  invalid_params?: Array<{ name: string; reason: string }>
}

export type FreepikMysticModel = 
  | 'realism' 
  | 'fluid' 
  | 'zen' 
  | 'flexible' 
  | 'super_real' 
  | 'editorial_portraits'
  | 'mystic'
  | 'flux_1_1_ultra'
  | 'ideogram'

export type FreepikResolution = '1k' | '2k' | '4k'

export type FreepikAspectRatio = 
  | 'square_1_1' 
  | 'classic_4_3' 
  | 'traditional_3_4' 
  | 'widescreen_16_9' 
  | 'social_story_9_16'
  | 'standard_3_2'
  | 'portrait_2_3'

export interface MysticGenerateInput {
  prompt: string
  webhookUrl?: string
  model?: FreepikMysticModel
  resolution?: FreepikResolution
  aspectRatio?: FreepikAspectRatio
  styleReference?: string // Base64 or URL
  structureReference?: string // Base64 or URL
  structureStrength?: number // 0-100
  styleAdherence?: number // 0-100
  creativeDetailing?: number // 0-100
  fixedGeneration?: boolean
}

export interface SeedreamEditInput {
  prompt: string
  referenceImages: string[] // URLs or Base64 (max 14)
  webhookUrl?: string
  aspectRatio?: FreepikAspectRatio
  seed?: number
}

/**
 * Get API key from environment
 */
function getApiKey(): string {
  const apiKey = process.env.FREEPIK_API_KEY
  if (!apiKey) {
    throw new Error('FREEPIK_API_KEY is not configured')
  }
  return apiKey
}

/**
 * Make authenticated request to Freepik API
 */
async function freepikFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const apiKey = getApiKey()
  
  const response = await fetch(`${FREEPIK_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'x-freepik-api-key': apiKey,
      ...options.headers,
    },
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as FreepikErrorResponse
    throw new Error(
      errorData.message || `Freepik API error: ${response.status} ${response.statusText}`
    )
  }

  return response.json() as Promise<T>
}

/**
 * Image to Prompt - Extract prompt from image
 * 
 * @param imageUrl - URL of the image
 * @param webhookUrl - Optional webhook URL for async notification
 * @returns Task response with task_id
 */
export async function imageToPrompt(
  imageUrl: string,
  webhookUrl?: string
): Promise<FreepikTaskResponse> {
  const body: Record<string, unknown> = {
    image: imageUrl,
  }

  if (webhookUrl) {
    body.webhook_url = webhookUrl
  }

  return freepikFetch<FreepikTaskResponse>('/image-to-prompt', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * Get Image to Prompt task status
 */
export async function getImageToPromptStatus(
  taskId: string
): Promise<FreepikTaskResponse> {
  return freepikFetch<FreepikTaskResponse>(`/image-to-prompt/${taskId}`)
}

/**
 * Improve Prompt - Enhance prompt with AI
 * 
 * @param prompt - Original prompt to improve
 * @param type - 'image' or 'video'
 * @param webhookUrl - Optional webhook URL
 * @param language - Language code (default: 'en')
 * @returns Task response with task_id
 */
export async function improvePrompt(
  prompt: string,
  type: 'image' | 'video' = 'image',
  webhookUrl?: string,
  language: string = 'en'
): Promise<FreepikTaskResponse> {
  const body: Record<string, unknown> = {
    prompt,
    type,
    language,
  }

  if (webhookUrl) {
    body.webhook_url = webhookUrl
  }

  return freepikFetch<FreepikTaskResponse>('/improve-prompt', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * Get Improve Prompt task status
 */
export async function getImprovePromptStatus(
  taskId: string
): Promise<FreepikTaskResponse> {
  return freepikFetch<FreepikTaskResponse>(`/improve-prompt/${taskId}`)
}

/**
 * Mystic - Generate image from text
 * 
 * @param input - Generation parameters
 * @returns Task response with task_id
 */
export async function mysticGenerate(
  input: MysticGenerateInput
): Promise<FreepikTaskResponse> {
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    model: input.model || 'realism',
    resolution: input.resolution || '2k',
    aspect_ratio: input.aspectRatio || 'square_1_1',
    filter_nsfw: true,
  }

  if (input.webhookUrl) {
    body.webhook_url = input.webhookUrl
  }

  if (input.styleReference) {
    body.style_reference = input.styleReference
  }

  if (input.structureReference) {
    body.structure_reference = input.structureReference
  }

  if (input.structureStrength !== undefined) {
    body.structure_strength = input.structureStrength
  }

  if (input.styleAdherence !== undefined) {
    body.adherence = input.styleAdherence
  }

  if (input.creativeDetailing !== undefined) {
    body.creative_detailing = input.creativeDetailing
  }

  if (input.fixedGeneration !== undefined) {
    body.fixed_generation = input.fixedGeneration
  }

  return freepikFetch<FreepikTaskResponse>('/mystic', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * Get Mystic task status
 */
export async function getMysticStatus(
  taskId: string
): Promise<FreepikTaskResponse> {
  return freepikFetch<FreepikTaskResponse>(`/mystic/${taskId}`)
}

/**
 * Seedream 4.5 Edit - Edit images with reference
 * 
 * @param input - Edit parameters
 * @returns Task response with task_id
 */
export async function seedreamEdit(
  input: SeedreamEditInput
): Promise<FreepikTaskResponse> {
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    reference_images: input.referenceImages,
    aspect_ratio: input.aspectRatio || 'square_1_1',
  }

  if (input.webhookUrl) {
    body.webhook_url = input.webhookUrl
  }

  if (input.seed !== undefined) {
    body.seed = input.seed
  }

  return freepikFetch<FreepikTaskResponse>('/text-to-image/seedream-v4-5-edit', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * Get Seedream task status
 */
export async function getSeedreamStatus(
  taskId: string
): Promise<FreepikTaskResponse> {
  return freepikFetch<FreepikTaskResponse>(`/text-to-image/seedream-v4-5-edit/${taskId}`)
}

/**
 * Poll for task completion with timeout
 * 
 * @param taskId - Task ID to poll
 * @param getStatus - Function to get task status
 * @param maxWaitMs - Maximum wait time in ms (default: 120000 = 2 min)
 * @param intervalMs - Poll interval in ms (default: 2000 = 2 sec)
 * @returns Completed task response
 */
export async function pollTaskCompletion(
  taskId: string,
  getStatus: (id: string) => Promise<FreepikTaskResponse>,
  maxWaitMs: number = 120000,
  intervalMs: number = 2000
): Promise<FreepikTaskResponse> {
  const startTime = Date.now()

  while (Date.now() - startTime < maxWaitMs) {
    const response = await getStatus(taskId)
    
    if (response.data.status === 'COMPLETED') {
      return response
    }
    
    if (response.data.status === 'FAILED') {
      throw new Error('Freepik task failed')
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }

  throw new Error('Freepik task timeout')
}

/**
 * Utility: Convert image URL to Base64
 */
export async function imageUrlToBase64(imageUrl: string): Promise<string> {
  const response = await fetch(imageUrl)
  const buffer = await response.arrayBuffer()
  const base64 = Buffer.from(buffer).toString('base64')
  return base64
}

/**
 * Utility: Auto-append "no text" instructions to prompt
 */
export function appendNoTextInstructions(prompt: string): string {
  const noTextSuffix = ', NO TEXT, NO LOGO, NO WATERMARK, NO TYPOGRAPHY, clean professional design'
  
  // Avoid duplicate if already present
  if (prompt.toLowerCase().includes('no text') || prompt.toLowerCase().includes('no logo')) {
    return prompt
  }
  
  return prompt + noTextSuffix
}
