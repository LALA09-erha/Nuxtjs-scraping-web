// import { defineEventHandler } from 'h3'
// import axios from 'axios'

// export default defineEventHandler(async (event) => {
//   try {
//     // Test 1: Blogger API dengan API Key (read-only)
//     const blogId = process.env.BLOGGER_BLOG_ID!
//     const apiKey = process.env.BLOGGER_API_KEY!
    
//     const blogInfoUrl = `https://www.googleapis.com/blogger/v3/blogs/${blogId}?key=${apiKey}`
    
//     console.log('Testing Blogger API connection...')
    
//     const response = await axios.get(blogInfoUrl, { timeout: 10000 })
    
//     return {
//       success: true,
//       blogger: {
//         blogId: response.data.id,
//         name: response.data.name,
//         url: response.data.url,
//         posts: response.data.posts?.totalItems || 0
//       },
//       environment: {
//         hasBloggerAccessToken: !!process.env.BLOGGER_ACCESS_TOKEN,
//         hasRefreshToken: !!process.env.BLOGGER_REFRESH_TOKEN,
//         rssFeedUrl: process.env.RSS_FEED_URL
//       }
//     }

//   } catch (error: any) {
//     console.error('Connection test failed:', error.message)
    
//     return {
//       success: false,
//       error: error.message,
//       details: error.response?.data
//     }
//   }
// })