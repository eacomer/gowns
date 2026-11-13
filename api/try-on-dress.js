/**
 * Enchanted Gowns - private inventory-specific bridal AI preview.
 * WordPress PHP server calls this endpoint; browser must never call it directly.
 * Required Vercel variables: OPENAI_API_KEY, EGSP2_DRESS_TRYON_SECRET,
 * and DRESS_TRYON_ENABLED=true.
 */
import OpenAI, { toFile } from 'openai';
import { timingSafeEqual } from 'node:crypto';

export const config = {
  maxDuration: 60,
  api: { bodyParser: { sizeLimit: '3mb' } }
};

const MODEL = 'gpt-image-2.5-flare';
const IMAGE_HOST = 'enchantedgowns.com';
const IMAGE_PREFIX = '/egwp/wp-content/uploads/';
const PHOTO_PREFIX = 'data:image/jpeg;base64,';

function secureEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length > 0 && aa.length === bb.length && timingSafeEqual(aa, bb);
}

function validImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname === IMAGE_HOST &&
      (url.port === '' || url.port === '443') &&
      !url.username && !url.password &&
      url.pathname.startsWith(IMAGE_PREFIX) &&
      /\.(jpg|jpeg|png|webp)$/i.test(url.pathname) &&
      !url.search && !url.hash;
  } catch { return false; }
}

function parsePhoto(value) {
  if (typeof value !== 'string' || !value.startsWith(PHOTO_PREFIX)) {
    throw new Error('Upload a valid JPEG photo.');
  }
  const encoded = value.slice(PHOTO_PREFIX.length);
  if (encoded.length > 2200000 || encoded.length < 1000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('Photo is invalid or exceeds the size limit.');
  }
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.length > 1700000 || buffer.length < 500 ||
      buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error('Upload a smaller, valid JPEG photo.');
  }
  return buffer;
}

async function fetchGownImage(imageUrl) {
  // The host/path are strictly fixed above; no redirects permitted.
  const response = await fetch(imageUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(12000),
    headers: { Accept: 'image/jpeg,image/png,image/webp' }
  });
  if (!response.ok) throw new Error('Dress image could not be loaded.');
  const contentType = response.headers.get('content-type')?.split(';')[0].trim() || '';
  const formats = {
    'image/jpeg': ['dress.jpg', 'image/jpeg'],
    'image/png': ['dress.png', 'image/png'],
    'image/webp': ['dress.webp', 'image/webp']
  };
  if (!formats[contentType]) throw new Error('Unsupported inventory image type.');
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 5 * 1024 * 1024) throw new Error('Inventory image is too large.');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) {
    throw new Error('Inventory image is empty or too large.');
  }
  return { buffer, fileName: formats[contentType][0], mime: formats[contentType][1] };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (process.env.DRESS_TRYON_ENABLED !== 'true') {
    return res.status(503).json({ error: 'Inventory try-on is not enabled yet.' });
  }
  if (!process.env.EGSP2_DRESS_TRYON_SECRET || !process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'Inventory try-on is not configured.' });
  }
  if (!secureEqual(req.headers['x-eg-internal-secret'], process.env.EGSP2_DRESS_TRYON_SECRET)) {
    return res.status(403).json({ error: 'Unauthorized request.' });
  }

  const { photo, dressImageUrl, dressName, consent } = req.body || {};
  if (consent !== true || typeof dressName !== 'string' || dressName.length > 140 ||
      !validImageUrl(dressImageUrl)) {
    return res.status(400).json({ error: 'Invalid inventory dress or missing consent.' });
  }
  let bridePhoto;
  try { bridePhoto = parsePhoto(photo); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  try {
    const gown = await fetchGownImage(dressImageUrl);
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 48000,
      maxRetries: 0
    });
    const result = await openai.images.edit({
      model: MODEL,
      image: [
        await toFile(bridePhoto, 'customer.jpg', { type: 'image/jpeg' }),
        await toFile(gown.buffer, gown.fileName, { type: gown.mime })
      ],
      prompt: `Make one realistic, tasteful full-length bridal fashion preview. 
Image 1 is the adult customer's photo; preserve the person's identifiable facial appearance, visible skin tone, hair, pose, and overall body proportions as closely as possible. 
Image 2 is the reference photo of the actual inventory wedding gown named "${dressName.replace(/[<>\r\n]/g, '')}". Replace the customer's clothes with a wedding gown closely resembling the reference image's neckline, straps or sleeves, bodice, fabric, embellishments, skirt shape and length. 
Use a natural standing pose. Show the complete outfit from head to hem. Keep background unobtrusive. Do not insert any text, brand names or watermarks. This is a visualization, not a fit guarantee.`,
      size: '1024x1536',
      quality: 'low',
      output_format: 'jpeg',
      output_compression: 60
    });
    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) return res.status(502).json({ error: 'No preview image returned.' });
    // Vercel caps response body to 4.5 MB; reject oversize rather than fail mysteriously.
    if (b64.length > 3400000) {
      return res.status(502).json({ error: 'Preview image was too large. Please try again.' });
    }
    return res.status(200).json({
      image: `data:image/jpeg;base64,${b64}`,
      disclaimer: 'AI illustration only; actual gown details, fit and proportions may vary.'
    });
  } catch (err) {
    console.error('try-on-dress failure:', { status: err.status, code: err.code, message: err.message });
    const safeMessage = err.message === 'Inventory image is too large.' ||
      err.message === 'Dress image could not be loaded.' ||
      err.message === 'Unsupported inventory image type.'
      ? err.message : 'The virtual try-on service could not complete the request.';
    return res.status(502).json({ error: safeMessage });
  }
}
