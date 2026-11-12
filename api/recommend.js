
/**
 * Enchanted Gowns - Wedding Dress Recommendation API
 *
 * Hosting: Vercel
 * Endpoint: /api/recommend
 *
 * Text model: gpt-4o-mini
 * Image model: gpt-image-2.5-flare
 *
 * Optimized for:
 * - Lower image generation cost
 * - Faster response times
 * - WordPress plugin compatibility
 * - Graceful image failures
 */

// Allow more time for image generation.
// Actual limit depends on Vercel plan/configuration.
export const config = {
  maxDuration: 60
};

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 55000,
  maxRetries: 0
});

// Configuration
const TEXT_MODEL = 'gpt-4o-mini';
const IMAGE_MODEL = 'gpt-image-2.5-flare';

// Change low to medium for improved image quality.
const IMAGE_QUALITY = 'low';

const IMAGE_SIZE = '1024x1024';
const MAX_RECOMMENDATIONS = 3;

export default async function handler(req, res) {

  // ----------------------------------------------------
  // 1. CORS HEADERS
  // ----------------------------------------------------

  res.setHeader(
    'Access-Control-Allow-Origin',
    'https://enchantedgowns.com'
  );

  res.setHeader(
    'Access-Control-Allow-Methods',
    'POST, OPTIONS'
  );

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

  res.setHeader(
    'Cache-Control',
    'no-store'
  );

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  // ----------------------------------------------------
  // 2. CHECK API CONFIGURATION
  // ----------------------------------------------------

  if (!process.env.OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY');

    return res.status(500).json({
      error: 'Service configuration error'
    });
  }

  try {

    // ------------------------------------------------
    // 3. READ USER MEASUREMENTS
    // ------------------------------------------------

    const {
      bust,
      waist,
      hips,
      heightFeet,
      heightInches
    } = req.body || {};

    const measurements = [
      bust,
      waist,
      hips,
      heightFeet,
      heightInches
    ].map(Number);

    const [
      bustNum,
      waistNum,
      hipsNum,
      feetNum,
      inchesNum
    ] = measurements;

    // Validate numbers
    if (
      measurements.some(n => !Number.isFinite(n)) ||
      bustNum <= 0 ||
      waistNum <= 0 ||
      hipsNum <= 0 ||
      bustNum > 120 ||
      waistNum > 120 ||
      hipsNum > 120 ||
      !Number.isInteger(feetNum) ||
      !Number.isInteger(inchesNum) ||
      feetNum < 0 ||
      feetNum > 8 ||
      inchesNum < 0 ||
      inchesNum > 11 ||
      feetNum * 12 + inchesNum < 24
    ) {
      return res.status(400).json({
        error: 'Please enter valid measurements.'
      });
    }

    const measurementText =
      `Bust: ${bustNum} inches, ` +
      `Waist: ${waistNum} inches, ` +
      `Hips: ${hipsNum} inches, ` +
      `Height: ${feetNum} feet ${inchesNum} inches`;

    console.log('Processing wedding dress recommendation');

    // ------------------------------------------------
    // 4. GENERATE DRESS STYLE RECOMMENDATIONS
    // ------------------------------------------------

    const chat = await openai.chat.completions.create({

      model: TEXT_MODEL,

      temperature: 0.4,

      max_tokens: 120,

      messages: [
        {
          role: 'system',
          content:
            'You are an expert bridal stylist for ' +
            'Enchanted Gowns, a wedding dress boutique. ' +
            'Recommend flattering dress silhouettes ' +
            'based on measurements. ' +
            'Never make negative judgments about body shape. ' +
            'Provide short, clear style names only.'
        },
        {
          role: 'user',
          content:
            `Bride measurements: ${measurementText}. ` +
            `Recommend exactly three distinct wedding ` +
            `dress silhouettes that may flatter these ` +
            `proportions. Choose familiar styles such as ` +
            `A-Line, Ball Gown, Mermaid, Sheath, Empire, ` +
            `Fit and Flare, or Trumpet. ` +
            `Return ONLY the three style names, ` +
            `one per line. Do not number them.`
        }
      ]
    });

    // ------------------------------------------------
    // 5. EXTRACT RECOMMENDED STYLES
    // ------------------------------------------------

    const raw =
      chat.choices?.[0]?.message?.content || '';

    const styles = [
      ...new Set(
        raw
          .split(/\r?\n/)
          .map(s =>
            s.replace(
              /^[\d.\-)*\s]+/,
              ''
            ).trim()
          )
          .filter(Boolean)
          .map(s => s.substring(0, 80))
      )
    ].slice(0, MAX_RECOMMENDATIONS);

    if (styles.length === 0) {
      console.error('No styles returned by text model');

      return res.status(502).json({
        error: 'Could not generate recommendations'
      });
    }

    console.log('Recommended styles:', styles);

    // ------------------------------------------------
    // 6. GENERATE IMAGES IN PARALLEL
    // ------------------------------------------------

    const images = await Promise.all(

      styles.map(async style => {

        try {

          const imageResponse =
            await openai.images.generate({

              model: IMAGE_MODEL,

              prompt:
                `Professional bridal boutique fashion ` +
                `photography. Full-length front view ` +
                `of an adult model wearing an elegant ` +
                `${style} wedding gown. ` +
                `Clearly emphasize the silhouette ` +
                `and shape of the dress. ` +
                `Ivory bridal fabric, realistic ` +
                `details, soft natural studio ` +
                `lighting, clean neutral background. ` +
                `Entire wedding dress visible ` +
                `from neckline to hem. ` +
                `No writing, no logos, no watermark.`,

              size: IMAGE_SIZE,

              quality: IMAGE_QUALITY,

              output_format: 'jpeg',

              output_compression: 65,

              n: 1
            });

          const base64 =
            imageResponse?.data?.[0]?.b64_json;

          if (!base64) {
            console.warn(
              `No image data returned for ${style}`
            );
            return null;
          }

          // Convert to browser-compatible data URL.
          return `data:image/jpeg;base64,${base64}`;

        } catch (imageError) {

          console.error(
            `Image generation error (${style}):`,
            imageError.message
          );

          // Allow other recommendations to succeed.
          return null;
        }

      })
    );

    // ------------------------------------------------
    // 7. RETURN RESULTS TO WORDPRESS
    // ------------------------------------------------

    const imagesGenerated =
      images.filter(Boolean).length;

    console.log(
      `Generated ${imagesGenerated} of ` +
      `${styles.length} images`
    );

    // Keep exact field names expected by
    // the existing WordPress plugin.

    return res.status(200).json({

      recommendations: styles,

      images: images

    });

  } catch (error) {

    // ------------------------------------------------
    // 8. ERROR HANDLING
    // ------------------------------------------------

    console.error(
      'recommend.js server error:',
      error.message
    );

    return res.status(500).json({
      error: 'Unable to process recommendation'
    });

  }
}
