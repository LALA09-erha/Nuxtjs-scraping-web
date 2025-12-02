import { defineEventHandler } from 'h3'
import axios from 'axios'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const refreshToken = body.refresh_token || process.env.BLOGGER_REFRESH_TOKEN
  
  if (!refreshToken) {
    return {
      success: false,
      error: 'No refresh token provided'
    }
  }

  try {
    const tokenUrl = 'https://oauth2.googleapis.com/token'
    
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })

    const response = await axios.post(tokenUrl, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })

    const newTokens = response.data
    
    return {
      success: true,
      tokens: {
        access_token: newTokens.access_token,
        expires_in: newTokens.expires_in,
        token_type: newTokens.token_type
      },
      message: 'Access token refreshed successfully'
    }

  } catch (error: any) {
    console.error('Refresh token error:', error.response?.data || error.message)
    
    return {
      success: false,
      error: 'Token refresh failed',
      details: error.response?.data || error.message
    }
  }
})