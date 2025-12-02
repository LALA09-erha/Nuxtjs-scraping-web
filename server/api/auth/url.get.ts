import { defineEventHandler } from 'h3'

export default defineEventHandler(async (event) => {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const redirectUri = encodeURIComponent(process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/callback')
  
  const scopes = [
    'https://www.googleapis.com/auth/blogger'
  ]
  
  const authUrl = `https://accounts.google.com/o/oauth2/auth?` +
    `client_id=${clientId}` +
    `&redirect_uri=${redirectUri}` +
    `&scope=${encodeURIComponent(scopes.join(' '))}` +
    `&response_type=code` +
    `&access_type=offline` +
    `&prompt=consent`
  
  return {
    url: authUrl,
    instructions: 'Buka URL ini di browser, login dengan akun Google yang memiliki akses ke blog, lalu copy code dari URL redirect'
  }
})