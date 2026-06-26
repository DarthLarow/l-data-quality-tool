import OpenAI from 'openai'

export const aiClient = new OpenAI({
  baseURL: process.env.AI_BASE_URL,
  apiKey:  process.env.AI_AUTH_TOKEN,
})
