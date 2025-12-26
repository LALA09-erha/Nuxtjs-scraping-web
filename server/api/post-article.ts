import { defineEventHandler } from 'h3'
import Parser from 'rss-parser'
import * as cheerio from 'cheerio'
import { MongoClient } from 'mongodb'
import axios from 'axios'
import { google } from 'googleapis'

const parser = new Parser()

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
    

    // Format konten untuk Blogger
    const formattedContent = formatContentForBlogger(article)

    // Siapkan label/tags
    const labels = article.tags || []
    if (article.category && !labels.includes(article.category)) {
      labels.push(article.category)
    }


    const postContent = `${formattedContent}`

    // Buat data post
    const postData: any = {
      title: article.title + ' | Info Loker Indonesia Terbaru',
      content: postContent,
      labels: labels
    }

    // API_URL dari environment variable API_URL+/api/posts
    const url = `${process.env.API_URL}/api/posts`

    // Kirim request ke API untuk membuat method get
    var response = await axios.post(url, {
      params: postData,
      headers: {
        'Content-Type': 'application/json',
        'X-XSRF-TOKEN': process.env.XSRF_TOKEN || 'xvT8KknsAh5t2GXOdqPsMp7yVRxRBedw1MkZtteU',
      },
      data: postData
    });
    if (response.data && response.data.success) {
      return {
        success: true,
        blogUrl: response.data.url,
      }
    } else {
      return {
        success: false,
        error: {
          code: 'INVALID_RESPONSE',
          message: 'Respon tidak valid dari Blogger API',
          details: response.data
        }
      }
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
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    // run setiap 23.30
    const isTrue = currentHour === 23 && currentMinute === 30;
    if (!isTrue) {
        return { 
            success: true, 
            saved: 0, 
            message: 'Diluar jam 10 malam, skip.' 
        };
    }
    const meta = await metadata.findOne({ name: 'rssPostLastRun' });
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
    // // Update last run time
    await metadata.updateOne(
        { name: 'rssPostLastRun' },
        { $set: { lastRun: now } },
        { upsert: true }
    );
    
    // ambil semua artikel yang belum diposting (status 'pending') atau failed
    const pendingArticles = await articles.find({ status: { $in: ['pending', 'failed'] } }).toArray();
    // upload to blogger
    if(pendingArticles.length === 0){
        return { 
            success: true, 
            saved: 0, 
            message: 'Tidak ada artikel baru untuk diposting.' 
        };
    }
    // loop dan post ke blogger
    let savedCount = 0;
    let article = [];
    for (const articleRecord of pendingArticles) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const postToBloggerResult = await postToBlogger({
            title: articleRecord.title,
            content: articleRecord.content,
            originalUrl: articleRecord.originalUrl,
            tags: articleRecord.tags,
            category: articleRecord.category,
            excerpt: articleRecord.excerpt,
            source: articleRecord.source,
            hasImages: articleRecord.hasImages,
            featuredImage: articleRecord.featuredImage,
            contentLength: articleRecord.contentLength,
        });
        // push hasilnya ke array article
        article.push(
          postToBloggerResult
        );
        if (postToBloggerResult.success) {
            // update status berhasil
            await articles.updateOne(
                { _id: articleRecord._id },
                { $set: { status: 'posted'} }
            );
            savedCount++;
        } else {
            // update status gagal
            // rssPostLastRun hapus dari metadata
            await metadata.deleteOne({ name: 'rssPostLastRun' });
            await articles.updateOne(
                { _id: articleRecord._id },
                { $set: { status: 'failed' } }
            );
        }
    }
    return { 
      success: true, 
      saved: savedCount, 
      message: `${savedCount} artikel berhasil diposting ke Blogger.`,
      articles: article
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
  postToBlogger,
}