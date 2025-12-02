import { defineEventHandler } from 'h3'
import Parser from 'rss-parser'
import * as cheerio from 'cheerio'
import { MongoClient } from 'mongodb'
import axios from 'axios'

const parser = new Parser()

// URL Google Apps Script Web App
const GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxXlHvWxtgGKQY2cYRbd8MgjjgKuUUylMbagsJkZG8iL8NRqaGTbKszupAeo6BY-g3V/exec'

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
    
    const featuredImageElement = $('img.lazy.youtube-thumbnail').first()
    if (featuredImageElement.length) {
      let imgSrc = featuredImageElement.attr('data-src') || ''
      if (imgSrc && imgSrc.includes('wp-content')) {
        if (!imgSrc.startsWith('http')) {
          imgSrc = `${baseUrl}${imgSrc}`
        }
        featuredImageSrc = imgSrc
        const altText = featuredImageElement.attr('alt') || title
        featuredImageHtml = `<img src="${imgSrc}" alt="${altText}" style="max-width:100%; height:auto;" />\n\n`
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
    
    // Buat excerpt dari konten (ambil 200 karakter pertama)
    const excerpt = finalContent.replace(/<[^>]*>/g, ' ').substring(0, 200).trim() + '...'
    
    // Cari kategori dari meta atau URL
    let category = 'Lowongan Kerja'
    const categoryMeta = $('meta[property="article:section"]').attr('content')
    if (categoryMeta) {
      category = categoryMeta
    }

    console.log(`✅ Konten berhasil di-scrape`)
    console.log(`📊 Panjang: ${finalContent.length} karakter`)
    console.log(`🏷️  Tags: ${tagNames.join(', ')}`)
    console.log(`🖼️  Gambar: ${hasImages ? 'Ada' : 'Tidak ada'}`)

    return {
      title,
      content: finalContent,
      originalUrl: url,
      tags: tagNames,
      contentLength: finalContent.length,
      hasImages,
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
  console.log('🔄 Memulai proses fetch RSS dengan scraper advanced...')
  console.log('Waktu:', new Date().toLocaleString('id-ID'))

  // === 1. Validasi Environment Variables ===
  const requiredEnvVars = [
    'MONGODB_URI',
    'RSS_FEED_URL'
  ]

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(`❌ Environment variable ${envVar} tidak ditemukan`)
      return { 
        success: false, 
        error: `Missing ${envVar}`,
        message: 'Silakan setup environment variables terlebih dahulu'
      }
    }
  }

  // === 2. Koneksi ke MongoDB ===
  let client
  try {
    client = new MongoClient(process.env.MONGODB_URI!)
    await client.connect()
    console.log('✅ Terhubung ke MongoDB')
    
    const db = client.db(process.env.MONGODB_DB || 'dc_db')
    const articles = db.collection('articles')
    const metadata = db.collection('metadata')

    // === 3. Cek apakah sudah dijalankan dalam 2 jam terakhir ===
    const lastRun = await metadata.findOne({ key: 'last_cron_run' })
    const now = new Date()
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000)

    if (lastRun && lastRun.timestamp > twoHoursAgo) {
      console.log('⏭️ Dilewati: belum 2 jam sejak eksekusi terakhir')
      console.log(`Terakhir dijalankan: ${lastRun.timestamp.toLocaleString('id-ID')}`)
      return { 
        success: true, 
        skipped: true, 
        reason: 'Too soon',
        lastRun: lastRun.timestamp
      }
    }

    // === 4. Update timestamp terakhir run ===
    await metadata.updateOne(
      { key: 'last_cron_run' },
      { $set: { timestamp: now } },
      { upsert: true }
    )

    // === 5. Ambil RSS Feed ===
    console.log(`📡 Mengambil RSS dari: ${process.env.RSS_FEED_URL}`)
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

    // === 6. Ambil artikel terbaru yang belum diproses ===
    let latestItem = null
    for (const item of feed.items) {
      if (!item.link) continue
      
      // Cek apakah artikel sudah ada di database
      const exists = await articles.findOne({ originalUrl: item.link })
      if (!exists) {
        latestItem = item
        break // Ambil yang pertama (terbaru) yang belum ada
      }
    }

    if (!latestItem) {
      console.log('📭 Semua artikel sudah diproses sebelumnya')
      return { 
        success: true, 
        saved: 0, 
        message: 'Tidak ada artikel baru' 
      }
    }

    console.log(`🆕 Artikel baru ditemukan: ${latestItem.title}`)

    // === 7. Proses artikel terbaru dengan scraper advanced ===
    try {
      // Scrape konten lengkap dengan scraper advanced
      const scrapedArticle = await scrapeLokerBumnArticleAdvanced(latestItem.link!)
      
      if (!scrapedArticle || !scrapedArticle.content.trim()) {
        console.warn('⚠️ Konten kosong untuk:', latestItem.link)
        return { 
          success: false, 
          error: 'Empty content',
          article: latestItem.title
        }
      }
      
      // Gunakan data dari scraper advanced
      const articleData = {
        title: scrapedArticle.title || latestItem.title || 'Tanpa Judul',
        originalUrl: latestItem.link,
        content: scrapedArticle.content,
        excerpt: scrapedArticle.excerpt || latestItem.contentSnippet || scrapedArticle.content.substring(0, 200) + '...',
        source: scrapedArticle.source || feed.title || 'lokerbumn.com',
        publishedAt: latestItem.pubDate ? new Date(latestItem.pubDate) : now,
        category: scrapedArticle.category || latestItem.categories?.[0] || 'Lowongan Kerja',
        tags: scrapedArticle.tags || [],
        hasImages: scrapedArticle.hasImages || false,
        featuredImage: scrapedArticle.featuredImage || null,
        createdAt: now,
        updatedAt: now,
        savedToSheets: false,
        sheetsRow: null,
        sheetsUrl: null,
        contentLength: scrapedArticle.contentLength || 0
      }

      const insertResult = await articles.insertOne(articleData)
      console.log(`💾 Disimpan ke database dengan ID: ${insertResult.insertedId}`)
      console.log(`📊 Panjang konten: ${articleData.contentLength} karakter`)
      console.log(`🏷️  Tags: ${articleData.tags.join(', ')}`)
      console.log(`🖼️  Gambar: ${articleData.hasImages ? 'Ada' : 'Tidak ada'}`)

      // === 8. Simpan ke Google Sheets via Google Apps Script ===
      const sheetsResult = await saveToGoogleSheetsViaAppsScript({
        title: articleData.title,
        content: articleData.content,
        originalUrl: articleData.originalUrl,
        category: articleData.category,
        source: articleData.source,
        publishedDate: articleData.publishedAt,
        excerpt: articleData.excerpt,
        tags: articleData.tags,
        hasImages: articleData.hasImages,
        contentLength: articleData.contentLength
      })

      if (sheetsResult.success) {
        // Update status di database
        await articles.updateOne(
          { _id: insertResult.insertedId },
          { 
            $set: { 
              savedToSheets: true,
              sheetsRow: sheetsResult.rowNumber,
              sheetsUrl: sheetsResult.sheetsUrl,
              updatedAt: new Date()
            } 
          }
        )

        console.log(`✅ Berhasil disimpan ke Google Sheets: ${sheetsResult.sheetsUrl}`)
        console.log(`🎉 Selesai! 1 artikel disimpan.`)
        
        return { 
          success: true, 
          saved: 1,
          article: {
            title: articleData.title,
            sheetsRow: sheetsResult.rowNumber,
            sheetsUrl: sheetsResult.sheetsUrl,
            tags: articleData.tags,
            contentLength: articleData.contentLength,
            hasImages: articleData.hasImages
          }
        }
      } else {
        // Jangan hapus dari database, tapi update status error
        await articles.updateOne(
          { _id: insertResult.insertedId },
          { 
            $set: { 
              savedToSheets: false,
              error: sheetsResult.error,
              updatedAt: new Date()
            } 
          }
        )
        
        console.error('❌ Gagal menyimpan ke Google Sheets:', sheetsResult.error)
        return { 
          success: false, 
          error: 'Google Sheets save failed',
          details: sheetsResult.error
        }
      }

    } catch (err) {
      console.error('❌ Error memproses artikel:', err)
      return { 
        success: false, 
        error: 'Processing failed',
        details: err instanceof Error ? err.message : 'Unknown error'
      }
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

// ==================== FUNGSI GOOGLE APPS SCRIPT ====================

/**
 * Simpan ke Google Sheets via Google Apps Script
 */
async function saveToGoogleSheetsViaAppsScript(article: {
  title: string;
  content: string;
  originalUrl: string;
  category: string;
  source: string;
  publishedDate: Date;
  excerpt: string;
  tags?: string[];
  hasImages?: boolean;
  contentLength?: number;
}): Promise<{ 
  success: boolean; 
  rowNumber?: number; 
  sheetsUrl?: string; 
  error?: any 
}> {
  try {
    console.log('📤 Mengirim data ke Google Apps Script...')
    
    // Format konten untuk Google Sheets (batasi panjang)
    const contentForSheets = article.content.substring(0, 10000)
    
    // Data yang akan dikirim
    const postData = {
      title: article.title,
      content: contentForSheets,
      originalUrl: article.originalUrl,
      category: article.category,
      source: article.source,
      publishedDate: article.publishedDate.toISOString().split('T')[0],
      excerpt: article.excerpt.substring(0, 500),
      tags: article.tags?.join(', ') || '',
      hasImages: article.hasImages || false,
      contentLength: article.contentLength || 0,
      status: 'MENUNGGU REVIEW',
      timestamp: new Date().toISOString()
    }

    console.log('📝 Data yang dikirim:', {
      judul: article.title.substring(0, 50) + '...',
      kategori: article.category,
      sumber: article.source,
      tags: article.tags?.join(', ') || 'Tidak ada',
      panjang: article.contentLength || 0,
      gambar: article.hasImages ? 'Ya' : 'Tidak'
    })

    // Kirim POST request ke Google Apps Script
    const response = await axios.post(GOOGLE_APPS_SCRIPT_URL, postData, {
      headers: {
        'Content-Type': 'application/json'
      },
      // Google Apps Script perlu parameter ini untuk menghindari CORS
      params: {
        muteHttpExceptions: true
      },
      timeout: 30000 // 30 detik timeout
    })

    console.log('✅ Response dari Google Apps Script:', {
      status: response.status,
      success: response.data.success,
      rowNumber: response.data.rowNumber
    })

    if (response.data.success) {
      return {
        success: true,
        rowNumber: response.data.rowNumber,
        sheetsUrl: response.data.sheetUrl || `https://docs.google.com/spreadsheets/d/11mHjzs6CVk-S2qELrEOlH4qur_XJVftE0mGbLHL4bE8/edit`
      }
    } else {
      throw new Error(response.data.error || 'Unknown error from Google Apps Script')
    }

  } catch (error: any) {
    console.error('❌ Error mengirim data ke Google Apps Script:')
    
    if (error.response) {
      console.error('Status:', error.response.status)
      console.error('Data:', error.response.data)
    } else {
      console.error('Error message:', error.message)
    }

    return {
      success: false,
      error: {
        code: 'APPS_SCRIPT_ERROR',
        message: error.message || 'Gagal mengirim data ke Google Apps Script',
        details: error.response?.data || null
      }
    }
  }
}

/**
 * Test koneksi ke Google Apps Script
 */
async function testGoogleAppsScriptConnection(): Promise<{ success: boolean; data?: any; error?: any }> {
  try {
    console.log('🔗 Testing koneksi ke Google Apps Script...')
    
    const response = await axios.get(GOOGLE_APPS_SCRIPT_URL, {
      params: {
        test: true
      },
      timeout: 10000
    })

    return {
      success: true,
      data: response.data
    }

  } catch (error: any) {
    console.error('Test connection error:', error.message)
    return {
      success: false,
      error: error.response?.data || error.message
    }
  }
}

/**
 * Test save data ke Google Apps Script
 */
async function testSaveToGoogleAppsScript(): Promise<{ success: boolean; data?: any; error?: any }> {
  try {
    const testData = {
      title: 'Test Artikel dari Nuxt dengan scraper advanced',
      content: '<p>Ini adalah konten test dari aplikasi Nuxt dengan fitur scraping advanced</p><img src="https://lokerbumn.com/wp-content/uploads/test.jpg" alt="Test Image">',
      originalUrl: 'https://lokerbumn.com/test-article/',
      category: 'Test',
      source: 'Test Source',
      publishedDate: new Date().toISOString().split('T')[0],
      excerpt: 'Ini adalah excerpt test dengan scraper advanced...',
      tags: ['test', 'loker', 'bumn'],
      hasImages: true,
      contentLength: 1500,
      status: 'TEST'
    }

    const response = await axios.post(GOOGLE_APPS_SCRIPT_URL, testData, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000
    })

    return {
      success: true,
      data: response.data
    }

  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data || error.message
    }
  }
}

/**
 * Test scraping artikel tunggal
 */
async function testScrapeSingleArticle(url: string): Promise<{ success: boolean; data?: any; error?: any }> {
  try {
    console.log(`🔍 Test scraping artikel: ${url}`)
    
    const article = await scrapeLokerBumnArticleAdvanced(url)
    
    if (article) {
      return {
        success: true,
        data: {
          title: article.title,
          contentLength: article.contentLength,
          tags: article.tags,
          hasImages: article.hasImages,
          excerpt: article.excerpt,
          category: article.category,
          hasFeaturedImage: !!article.featuredImage
        }
      }
    } else {
      return {
        success: false,
        error: 'Gagal scraping artikel'
      }
    }
    
  } catch (error: any) {
    return {
      success: false,
      error: error.message
    }
  }
}

// Export semua fungsi test
export { 
  testGoogleAppsScriptConnection, 
  testSaveToGoogleAppsScript,
  testScrapeSingleArticle,
  scrapeLokerBumnArticleAdvanced 
}