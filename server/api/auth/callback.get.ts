// import { defineEventHandler } from 'h3'
// import axios from 'axios'

// export default defineEventHandler(async (event) => {
//   const query = getQuery(event)
//   const code = query.code as string
  
//   if (!code) {
//     return { 
//       success: false, 
//       error: 'No authorization code provided' 
//     }
//   }

//   try {
//     const tokenUrl = 'https://oauth2.googleapis.com/token'
    
//     const params = new URLSearchParams({
//       code: code,
//       client_id: process.env.GOOGLE_CLIENT_ID!,
//       client_secret: process.env.GOOGLE_CLIENT_SECRET!,
//       redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
//       grant_type: 'authorization_code'
//     })

//     const response = await axios.post(tokenUrl, params.toString(), {
//       headers: {
//         'Content-Type': 'application/x-www-form-urlencoded'
//       }
//     })

//     const tokens = response.data
    
//     return {
//       success: true,
//       message: '✅ Authentication successful! Copy these tokens to your .env file:',
//       tokens: {
//         access_token: tokens.access_token,
//         refresh_token: tokens.refresh_token,
//         expires_in: tokens.expires_in,
//         token_type: tokens.token_type
//       },
//       instructions: [
//         '1. Copy access_token to BLOGGER_ACCESS_TOKEN in .env',
//         '2. Copy refresh_token to BLOGGER_REFRESH_TOKEN in .env',
//         '3. Save and restart your application'
//       ]
//     }

//   } catch (error: any) {
//     console.error('Auth error:', error.response?.data || error.message)
    
//     return {
//       success: false,
//       error: 'Authentication failed',
//       details: error.response?.data || error.message
//     }
//   }
// })