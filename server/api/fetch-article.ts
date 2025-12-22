import { defineEventHandler } from 'h3'
import Parser from 'rss-parser'
import * as cheerio from 'cheerio'
import { MongoClient } from 'mongodb'
import axios from 'axios'
import { google } from 'googleapis'

const parser = new Parser()

// ==================== FUNGSI REFRESH TOKEN ====================

/**
 * Refresh Google OAuth token
 */
async function refreshGoogleToken(): Promise<{
  success: boolean;
  access_token?: string;
  expiry_date?: number;
  has_new_refresh_token?: boolean;
  error?: any;
}> {
  try {
    console.log('🔄 Refreshing Google OAuth token...')
    
    const credentials = {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URIS?.split(',')[0] || 'https://developers.google.com/oauthplayground',
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    }

    if (!credentials.client_id || !credentials.client_secret || !credentials.refresh_token) {
      throw new Error('Google API credentials tidak lengkap')
    }

    const oauth2Client = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      credentials.redirect_uri
    )

    oauth2Client.setCredentials({
      refresh_token: credentials.refresh_token
    })
    // Refresh token
    const { credentials: newCredentials } = await oauth2Client.refreshAccessToken()
    // terima callback dengan newCredentials
    console.log(newCredentials)
    
    console.log('✅ Token berhasil di-refresh!')
    console.log('📝 Token baru:', {
      access_token: newCredentials.access_token?.substring(0, 20) + '...',
      expiry_date: new Date(newCredentials.expiry_date || 0).toLocaleString('id-ID'),
      refresh_token: newCredentials.refresh_token ? '✅ Ada baru' : '✅ Sama'
    })

    // Update environment jika ada refresh token baru
    if (newCredentials.refresh_token && newCredentials.refresh_token !== credentials.refresh_token) {
      console.log('🔄 Mendapatkan refresh token baru!')
      // Note: Dalam production, simpan ke database atau update environment variable
      // process.env.GOOGLE_REFRESH_TOKEN = newCredentials.refresh_token
    }

    return {
      success: true,
      access_token: newCredentials.access_token,
      expiry_date: newCredentials.expiry_date,
      has_new_refresh_token: !!newCredentials.refresh_token && newCredentials.refresh_token !== credentials.refresh_token
    }

  } catch (error: any) {
    console.error('❌ Gagal refresh token:', error.message)
    
    if (error.code === 400) {
      console.log('⚠️ Refresh token mungkin expired atau tidak valid')
      console.log('🔗 Dapatkan refresh token baru dari OAuth Playground')
    }
    
    return {
      success: false,
      error: error.message
    }
  }
}

// ==================== FUNGSI BLOGGER API DENGAN AUTO-REFRESH ====================

/**
 * Inisialisasi Blogger API dengan auto-refresh
 */
async function initializeBloggerAPI(): Promise<any> {
  try {
    const credentials = {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uris: process.env.GOOGLE_REDIRECT_URIS?.split(','),
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    }

    if (!credentials.client_id || !credentials.client_secret || !credentials.refresh_token) {
      throw new Error('Google API credentials tidak lengkap')
    }

    const oauth2Client = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      credentials.redirect_uris?.[0]
    )

    oauth2Client.setCredentials({
      refresh_token: credentials.refresh_token
    })

    // Tambahkan interceptor untuk auto-refresh saat token expired
    oauth2Client.on('tokens', (tokens) => {
      if (tokens.refresh_token) {
        console.log('🔄 Mendapatkan refresh token baru')
        // Di sini Anda bisa menyimpan refresh token baru ke database
      }
      if (tokens.access_token) {
        console.log('✅ Access token diperbarui')
      }
    })

    return google.blogger({
      version: 'v3',
      auth: oauth2Client
    })

  } catch (error) {
    console.error('❌ Error inisialisasi Blogger API:', error)
    throw error
  }
}


/**
 * Post artikel ke Blogger
 */
async function postToBlogger(article: {
  title: string;
  content: string;
  tags?: string[];
  category?: string;
  excerpt?: string;
  originalUrl?: string;
  featuredImage?: string;
}): Promise<{
  success: boolean;
  blogUrl?: string;
  postId?: string;
  error?: any;
}> {
  try {
    console.log('📝 Memposting artikel ke Blogger...')
    
    const BLOGGER_BLOG_ID = process.env.BLOGGER_BLOG_ID
    if (!BLOGGER_BLOG_ID) {
      throw new Error('BLOGGER_BLOG_ID tidak ditemukan')
    }

    const blogger = await initializeBloggerAPI()
    
    // Format konten untuk Blogger
    const formattedContent = formatContentForBlogger(article)

    // Siapkan label/tags
    const labels = article.tags || []
    if (article.category && !labels.includes(article.category)) {
      labels.push(article.category)
    }

    // Tambahkan keterangan sumber
    const sourceNote = article.originalUrl ? 
      `<p><em>Sumber: <a href="${article.originalUrl}" target="_blank">${article.originalUrl}</a></em></p>` : 
      ''

    const postContent = `${formattedContent}\n\n${sourceNote}`

    // Buat data post
    const postData: any = {
      title: article.title,
      content: postContent,
      labels: labels
    }

    // Jika ada featured image, tambahkan sebagai gambar utama
    if (article.featuredImage) {
      postData.images = [
        {
          url: article.featuredImage
        }
      ]
    }

    // Kirim ke Blogger API
    const response = await blogger.posts.insert({
      blogId: BLOGGER_BLOG_ID,
      requestBody: postData,
      isDraft: process.env.BLOGGER_POST_AS_DRAFT === 'true' || false,
      fetchImages: true,
      fetchBody: true
    })

    const postUrl = response.data.url
    const postId = response.data.id

    console.log('✅ Artikel berhasil diposting ke Blogger!')
    console.log('🔗 URL:', postUrl)
    console.log('🆔 Post ID:', postId)

    return {
      success: true,
      blogUrl: postUrl,
      postId: postId
    }

  } catch (error: any) {
    console.error('❌ Error memposting ke Blogger:')
    console.error('Message:', error.message)
    
    if (error.response) {
      console.error('Status:', error.response.status)
      console.error('Data:', error.response.data)
    }

    return {
      success: false,
      error: {
        code: 'BLOGGER_API_ERROR',
        message: error.message || 'Gagal memposting ke Blogger',
        details: error.response?.data || null
      }
    }
  }
}

/**
 * Format konten untuk Blogger
 */
function formatContentForBlogger(article: {
  content: string;
  excerpt?: string;
  category?: string;
  tags?: string[];
  originalUrl?: string;
}): string {
  let content = article.content

  // Hapus script dan style yang tidak perlu
  content = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
  content = content.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')

  // Optimalkan gambar untuk Blogger
  content = content.replace(/<img([^>]+)style="[^"]*"([^>]*)>/g, '<img$1$2 style="max-width:100%; height:auto;">')
  
  // Tambahkan alt text jika tidak ada
  content = content.replace(/<img((?!alt=)[^>])+>/g, (match) => {
    if (!match.includes('alt=')) {
      return match.replace('<img', '<img alt="Article Image"')
    }
    return match
  })

  // Tambahkan excerpt di awal jika ada
  if (article.excerpt) {
    const excerptHtml = `<div style="background:#f5f5f5;padding:15px;border-left:4px solid #4CAF50;margin-bottom:20px;">
      <p><strong>Ringkasan:</strong> ${article.excerpt}</p>
    </div>`
    content = excerptHtml + content
  }

  // Tambahkan tags/labels di akhir
  if (article.tags && article.tags.length > 0) {
    const tagsHtml = `<div style="margin-top:30px;padding-top:15px;border-top:1px dashed #ddd;">
      <p><strong>Label:</strong> ${article.tags.map(tag => `<code>${tag}</code>`).join(' ')}</p>
    </div>`
    content += tagsHtml
  }

  return content
}


// ==================== FUNGSI SCRAPER ADVANCED ====================

/**
 * Convert semua link tag/ ke format Blogger search/label
 */
function convertTagLinksToBlogger(htmlContent: string): string {
  const pattern = /href="https:\/\/lokerbumn\.com\/tag\/([^/"]+)\/"/g
  
  const convertedHtml = htmlContent.replace(pattern, (match, tagName) => {
    return `href="https://lokerinfo-id.blogspot.com/search/label/${tagName}"`
  })
  
  return convertedHtml
}

/**
 * Extract konten di antara iklan
 */
function extractContentBetweenAds(contentHtml: string): string {
  try {
    // Pattern untuk menemukan blok iklan yang menjadi pembatas
    const adStartPattern = /<script async="" crossorigin="anonymous" src="https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-6706202077409426"><\/script>\s*<!-- Dalam konten lokerbumn -->\s*<ins class="adsbygoogle"[^>]*><\/ins>\s*<script>\s*\(adsbygoogle = window\.adsbygoogle \|\| \[\]\)\.push\(\{\}\);\s*<\/script>\s*<\/div>/
    
    const adEndPattern = /<div class="code-block code-block-1"[^>]*>\s*<script async="" crossorigin="anonymous" src="https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-6706202077409426"><\/script>\s*<!-- lokerbumn 1 -->\s*<ins class="adsbygoogle"[^>]*><\/ins>\s*<script>\s*\(adsbygoogle = window\.adsbygoogle \|\| \[\]\)\.push\(\{\}\);\s*<\/script>\s*<\/div>/

    // Cari posisi iklan pertama (pembatas awal)
    const startAdMatch = contentHtml.match(adStartPattern)
    const endAdMatch = contentHtml.match(adEndPattern)

    if (startAdMatch && endAdMatch) {
      const startPos = startAdMatch.index! + startAdMatch[0].length
      const endPos = endAdMatch.index!
      
      // Ambil konten di antara kedua iklan
      let contentBetweenAds = contentHtml.substring(startPos, endPos)

      // Hapus iklan yang mungkin masih ada di dalam konten
      contentBetweenAds = contentBetweenAds.replace(adStartPattern, '')
      contentBetweenAds = contentBetweenAds.replace(adEndPattern, '')

      return contentBetweenAds
    } else {
      // Jika tidak menemukan kedua iklan, kembalikan semua konten tanpa iklan
      let cleanedHtml = contentHtml.replace(adStartPattern, '')
      cleanedHtml = cleanedHtml.replace(adEndPattern, '')
      return cleanedHtml
    }

  } catch (err) {
    console.error('Error extracting content between ads:', err)
    return contentHtml
  }
}

/**
 * Fix image URLs - pastikan URL lengkap
 */
function fixImageLinks(html: string, baseUrl: string): string {
  // Pattern untuk mencari tag img dengan src yang mengandung wp-content
  const imgPattern = /<img[^>]+src="([^"]*wp-content[^"]*)"[^>]*>/g
  
  return html.replace(imgPattern, (match, imgSrc) => {
    // Jika src tidak lengkap, tambahkan base URL
    if (imgSrc && !imgSrc.startsWith('http')) {
      const fixedSrc = `${baseUrl}${imgSrc}`
      return match.replace(`src="${imgSrc}"`, `src="${fixedSrc}"`)
    }
    return match
  })
}

/**
 * Scrape konten artikel lengkap dari lokerbumn.com (ADVANCED VERSION)
 */
async function scrapeLokerBumnArticleAdvanced(url: string): Promise<{
  title: string;
  content: string;
  originalUrl: string;
  tags: string[];
  contentLength: number;
  hasImages: boolean;
  featuredImage?: string;
  excerpt?: string;
  category?: string;
  source?: string;
} | null> {
  try {
    console.log(`🌐 Scraping advanced: ${url}`)
    
    const baseUrl = 'https://lokerbumn.com'
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://google.com'
      },
      timeout: 15000
    })

    const $ = cheerio.load(response.data)
    
    // JUDUL
    const titleElement = $('h1').first()
    const title = titleElement.text().trim() || 'No Title'
    
    console.log(`📰 Judul: ${title}`)

    // GAMBAR UTAMA
    let featuredImageHtml = ''
    let featuredImageSrc = ''
    
    // Cari gambar utama dari berbagai kemungkinan
    let featuredImageElement = $('img.lazy.youtube-thumbnail').first()
    if (!featuredImageElement.length) {
      featuredImageElement = $('img.attachment-full').first()
    }
    if (!featuredImageElement.length) {
      featuredImageElement = $('img.wp-post-image').first()
    }
    if (!featuredImageElement.length) {
      // Cari gambar pertama di konten
      featuredImageElement = $('div.ray-main-single-content img').first()
    }
    
    if (featuredImageElement.length) {
      let imgSrc = featuredImageElement.attr('data-src') || 
                   featuredImageElement.attr('src') || 
                   featuredImageElement.attr('data-lazy-src') || ''
      
      if (imgSrc && (imgSrc.includes('wp-content') || imgSrc.includes('.jpg') || imgSrc.includes('.png') || imgSrc.includes('.jpeg'))) {
        if (!imgSrc.startsWith('http')) {
          imgSrc = `${baseUrl}${imgSrc}`
        }
        featuredImageSrc = imgSrc
        const altText = featuredImageElement.attr('alt') || title
        featuredImageHtml = `<img src="${imgSrc}" alt="${altText}" style="max-width:100%; height:auto;" />\n\n`
        console.log(`🖼️ Gambar utama ditemukan: ${featuredImageSrc}`)
      }
    }

    // KONTEN UTAMA
    const contentDiv = $('div.ray-main-single-content').first()
    
    if (!contentDiv.length) {
      console.log('❌ Konten utama tidak ditemukan')
      return null
    }

    // HAPUS ELEMENT YANG TIDAK DIPERLUKAN
    contentDiv.find('div.ray-content-share').remove()

    // AMBIL KONTEN DI ANTARA IKLAN
    const contentHtml = contentDiv.html() || ''
    let contentBetweenAds = extractContentBetweenAds(contentHtml)

    // PERBAIKI LINK GAMBAR
    contentBetweenAds = fixImageLinks(contentBetweenAds, baseUrl)

    // TAGS
    const tagsDiv = $('div.ray-content-tags')
    let tagsContent = ''
    const tagNames: string[] = []
    
    if (tagsDiv.length) {
      const tagsLinks: string[] = []
      
      tagsDiv.find('a[href]').each((_, element) => {
        const $a = $(element)
        const tagText = $a.text().trim()
        let tagHref = $a.attr('href') || ''
        
        // Convert link tag ke format Blogger
        if (tagHref.includes('/tag/')) {
          const tagName = tagHref.split('/tag/')[1].replace(/\/$/, '')
          tagHref = `https://lokerinfo-id.blogspot.com/search/label/${tagName}`
        }
        
        tagsLinks.push(`<a href="${tagHref}">${tagText}</a>`)
        tagNames.push(tagText)
      })
      
      if (tagsLinks.length > 0) {
        tagsContent = `<div class='tags'><strong>Lokasi: </strong>${tagsLinks.join(', ')}</div>\n\n`
      }
    }

    // GABUNGKAN SEMUA KONTEN
    let finalContent = featuredImageHtml + contentBetweenAds

    // CONVERT TAG LINKS
    finalContent = convertTagLinksToBlogger(finalContent)

    // BERSIHKAN HTML TAMBAHAN
    const clean$ = cheerio.load(finalContent)
    
    // Hapus script dan style
    clean$('script, style').remove()
    
    // Hapus element dengan class yang tidak perlu
    const unwantedClasses = [
      'code-block', 'adsbygoogle', 'single-notification',
      'ray-content-share', 'content-share-left', 'content-share-right'
    ]
    
    unwantedClasses.forEach(className => {
      clean$(`.${className}`).remove()
    })
    
    // Tambahkan tags di akhir
    if (tagsContent) {
      clean$('body').append(tagsContent)
    }
    
    finalContent = clean$('body').html() || ''

    // FINAL CLEANUP - hapus element kosong
    finalContent = finalContent.replace(/<div[^>]*>\s*<\/div>/g, '')
    finalContent = finalContent.replace(/\n\s*\n/g, '\n\n').trim()

    // Cek apakah ada gambar dalam konten
    const hasImages = finalContent.includes('wp-content') || finalContent.includes('<img')
    
    // Hitung jumlah gambar
    const imgCount = (finalContent.match(/<img/g) || []).length
    
    // Buat excerpt dari konten (ambil 200 karakter pertama)
    const excerpt = finalContent.replace(/<[^>]*>/g, ' ').substring(0, 200).trim()
    
    // Cari kategori dari meta atau URL
    let category = 'Lowongan Kerja'
    const categoryMeta = $('meta[property="article:section"]').attr('content')
    if (categoryMeta) {
      category = categoryMeta
    }

    return {
      title,
      content: finalContent,
      originalUrl: url,
      tags: tagNames,
      contentLength: finalContent.length,
      hasImages: hasImages || !!featuredImageSrc,
      featuredImage: featuredImageSrc,
      excerpt,
      category,
      source: 'lokerbumn.com'
    }

  } catch (err) {
    console.error(`❌ Gagal scraping ${url}:`, err instanceof Error ? err.message : err)
    return null
  }
}

// ==================== MAIN HANDLER ====================

export default defineEventHandler(async (event) => {

  // === 1. Koneksi ke MongoDB ===
  let client
  try {
    client = new MongoClient(process.env.MONGODB_URI!)
    await client.connect()
    console.log('✅ Terhubung ke MongoDB')
    
    const db = client.db(process.env.MONGODB_DB || 'dc_db')
    const articles = db.collection('articles')
    const metadata = db.collection('metadata')

    const now = new Date()
    // Cek apakah sekarang jam 10 malam keatas  
    const currentHour = now.getHours();
    const isTenPM = currentHour === 22 || currentHour === 23;
    if (!isTenPM) {
        return { 
            success: true, 
            saved: 0, 
            message: 'Diluar jam 10 malam, skip.' 
        };
    }
    // run 2x sehari, cek last run di metadata jam 22 dan 23 malam
    const meta = await metadata.findOne({ name: 'rssFetchLastRun' });
    const lastRun = meta ? meta.lastRun : null;

    if (lastRun) {
        const lastRunDate = new Date(lastRun);
        const isSameDay = lastRunDate.toDateString() === now.toDateString();
        const lastRunHour = lastRunDate.getHours();
        
        // Cek apakah sudah dijalankan pada JAM YANG SAMA hari ini
        if (isSameDay && lastRunHour === currentHour) {
            return { 
                success: true, 
                saved: 0, 
                message: `Sudah dijalankan hari ini jam ${currentHour}:00, skip.` 
            };
        }
    }
    // Update last run time
    await metadata.updateOne(
        { name: 'rssFetchLastRun' },
        { $set: { lastRun: now } },
        { upsert: true }
    );
    
    let feed
    try {
      feed = await parser.parseURL(process.env.RSS_FEED_URL!)
      console.log(`✅ RSS dimuat: ${feed.items?.length || 0} artikel ditemukan`)
    } catch (err) {
      console.error('❌ Gagal mengambil RSS:', err)
      return { 
        success: false, 
        error: 'RSS fetch failed',
        details: err instanceof Error ? err.message : 'Unknown error'
      }
    }

    if (!feed.items || feed.items.length === 0) {
      console.log('📭 Tidak ada artikel dalam RSS feed')
      return { 
        success: true, 
        saved: 0, 
        message: 'Tidak ada artikel dalam RSS feed' 
      }
    }

  
    let totalCount = 0;
    for (const item of feed.items) {
      if (!item.link) continue
      // Scrape artikel lengkap
      var scrapedArticle = await scrapeLokerBumnArticleAdvanced(item.link!)
      // Lewati jika gagal scrape atau konten kosong
      if (!scrapedArticle || !scrapedArticle.content.trim()) {
        continue;
      }

      // Simpan data ke database
      var  articleData = {
        title: scrapedArticle.title || item.title || 'Tanpa Judul',
        originalUrl: item.link!,
        content: scrapedArticle.content,
        excerpt: scrapedArticle.excerpt,
        source: scrapedArticle.source || feed.title || 'lokerbumn.com',
        publishedAt: item.pubDate ? new Date(item.pubDate) : now,
        category: scrapedArticle.category || item.categories?.[0] || 'Lowongan Kerja',
        tags: scrapedArticle.tags || [],
        hasImages: scrapedArticle.hasImages || false,
        featuredImage: scrapedArticle.featuredImage || null,
        createdAt: now,
        updatedAt: now,
        postedToBlogger: false,
        bloggerUrl: null,
        bloggerPostId: null,
        contentLength: scrapedArticle.contentLength || 0,
        status : 'pending',
      }

      // Cek duplikasi berdasarkan originalUrl
      const existing = await articles.findOne({ originalUrl: articleData.originalUrl })
      if (existing) {
        continue
      }
      // hapus 1 data yang createdAt nya terlama dari semua data yang ada dan status nya failed
      const oldestCreatedAt = await articles.findOne({ status: 'failed' }, { sort: { createdAt: 1 } })
      if (oldestCreatedAt) {
        await articles.deleteOne({ createdAt: oldestCreatedAt.createdAt })
      }
      // check pokoknya yg ada di database max 7 data
      totalCount = await articles.countDocuments()
      // kalo totalnya udah 7, hapus data yg createdAt nya terlama
      if (totalCount >= 7) {
        const oldest = await articles.findOne({ status: { $in: ['failed', 'posted'] } }, { sort: { createdAt: 1 } })
        if (oldest) {
          await articles.deleteOne({ createdAt: oldest.createdAt })
        }
      }
      const insertResult = await articles.insertOne(articleData)
      console.log(`✅ Artikel disimpan dengan ID: ${insertResult.insertedId}`)
    }

    return { 
      success: true, 
      saved: totalCount, 
      message: 'Proses selesai' 
    }
  } catch (err) {
    console.error('❌ Error koneksi database atau proses:', err)
    return { 
      success: false, 
      error: 'System error',
      details: err instanceof Error ? err.message : 'Unknown error'
    }
  } finally {
    // Tutup koneksi MongoDB
    if (client) {
      await client.close()
      console.log('🔌 Koneksi MongoDB ditutup')
    }
  }
})


// Export semua fungsi
export { 
  scrapeLokerBumnArticleAdvanced,
  postToBlogger,
  refreshGoogleToken,
}