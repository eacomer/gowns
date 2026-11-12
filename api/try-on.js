/**
 * Enchanted Gowns virtual style try-on (illustrative, not exact fitting)
 * Vercel endpoint: POST /api/try-on
 * Requires OPENAI_API_KEY and a current OpenAI SDK that supports images.edit.
 * IMPORTANT: configure platform-level rate limits / bot protection before public launch.
 */
import OpenAI, { toFile } from 'openai';

export const config = { maxDuration: 120 };

const ALLOWED_ORIGIN = 'https://enchantedgowns.com';
const IMAGE_BASE = 'https://enchantedgowns.com/egwp/wp-content/uploads/2026/11/';
const DRESSES = Object.freeze({
  'A-Line': 'a-line.jpg',
  'Modified A-Line': 'modified-a-line.jpg',
  'Ball Gown': 'ball-gown.jpg',
  'Mermaid': 'mermaid.jpg',
  'Fit and Flare': 'fit-and-flare.jpg',
  'Trumpet': 'trumpet.jpg',
  'Sheath': 'sheath.jpg',
  'Empire': 'empire.jpg',
  'Tea Length': 'tea-length.jpg',
  'Mini': 'mini.jpg'
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 105000,
  maxRetries: 0
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Origin is defense in depth, NOT authentication or abuse prevention.
  const origin = req.headers.origin;
  if (origin !== ALLOWED_ORIGIN) return res.status(403).json({ error: 'Origin not permitted' });

  if (process.env.TRYON_ENABLED !== 'true') {
    return res.status(503).json({ error: 'Virtual try-on is not enabled yet' });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Service configuration error' });
  }

  try {
    const { style, photo, consent } = req.body || {};
    if (consent !== true) return res.status(400).json({ error: 'Photo-processing consent is required' });
    if (typeof style !== 'string' || !Object.hasOwn(DRESSES, style)) {
      return res.status(400).json({ error: 'Unknown gown style' });
    }
    if (typeof photo !== 'string' || photo.length > 2_300_000) {
      return res.status(413).json({ error: 'Please upload a smaller photo' });
    }
    const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(photo);
    if (!match) return res.status(400).json({ error: 'Expected a JPEG photo' });
    const personBytes = Buffer.from(match[1], 'base64');
    if (personBytes.length < 2000 || personBytes.length > 1_700_000 ||
        personBytes[0] !== 0xff || personBytes[1] !== 0xd8) {
      return res.status(400).json({ error: 'Invalid or oversized JPEG photo' });
    }

    // Only fetch from our own fixed allowlist; user cannot supply an arbitrary URL.
    const dressResponse = await fetch(IMAGE_BASE + DRESSES[style], {
      signal: AbortSignal.timeout(10000)
    });
    if (!dressResponse.ok) throw new Error('Dress reference image unavailable');
    const length = Number(dressResponse.headers.get('content-length') || 0);
    if (length > 3_000_000) throw new Error('Dress image too large');
    const dressBytes = Buffer.from(await dressResponse.arrayBuffer());
    if (dressBytes.length > 3_000_000) throw new Error('Dress image too large');

    // Image 1: consenting visitor; Image 2: silhouette reference.
    const edited = await openai.images.edit({
      model: 'gpt-image-2.5-flare',
      image: [
        await toFile(personBytes, 'customer.jpg', { type: 'image/jpeg' }),
        await toFile(dressBytes, 'gown.jpg', { type: 'image/jpeg' })
      ],
      prompt:
        `Make a realistic, tasteful full-length bridal style visualization. ` +
        `IMAGE 1 is the adult customer's uploaded photo: keep their face, hairstyle, ` +
        `skin tone, build, pose, and identity as faithfully as possible. ` +
        `IMAGE 2 is an illustrative reference for a ${style} wedding gown: ` +
        `dress the person from IMAGE 1 in a gown with the same overall silhouette ` +
        `and similar details as IMAGE 2. Preserve realistic body proportions. ` +
        `Show the complete person head to toe; neutral bridal studio setting. ` +
        `Do not add text, watermark, other people or exaggerated anatomy. ` +
        `This is a style preview, not an accurate sizing or garment-fit simulation.`,
      size: '1024x1536',
      quality: 'low',
      output_format: 'jpeg',
      output_compression: 55,
      n: 1
    });

    const image = edited?.data?.[0]?.b64_json;
    if (!image) throw new Error('No image returned');
    // Avoid Vercel's response-size limit.
    if (image.length > 3_700_000) throw new Error('Generated image response too large');

    return res.status(200).json({
      image: `data:image/jpeg;base64,${image}`,
      style,
      disclaimer: 'AI illustration only. Identity, proportions, design, and fit may differ from reality.'
    });
  } catch (error) {
    // Avoid recording user photos or full payloads in logs.
    console.error('try-on error:', error?.status || 'server', error?.message || 'unknown');
    return res.status(502).json({ error: 'Unable to create the try-on right now. Please try again later.' });
  }
}
