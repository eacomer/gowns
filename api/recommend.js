
/**
 * Enchanted Gowns - AI Wedding Dress Style Picker
 *
 * Version: 2.0 - Permanent Image Library
 *
 * Hosted on Vercel
 * Endpoint: /api/recommend
 *
 * Uses OpenAI for personalized recommendations.
 * Uses existing WordPress images instead of generating
 * new images for each visitor.
 *
 * Compatible with WordPress plugin v1.9.
 */

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 20000,
  maxRetries: 1
});

// ----------------------------------------------------
// CONFIGURATION
// ----------------------------------------------------

const TEXT_MODEL = 'gpt-4o-mini';
const MAX_RECOMMENDATIONS = 3;

const IMAGE_BASE =
  'https://enchantedgowns.com/egwp/wp-content/uploads/2026/11/';

// ----------------------------------------------------
// PERMANENT WEDDING GOWN IMAGE LIBRARY
// ----------------------------------------------------

const STYLE_IMAGES = {
  'A-Line': IMAGE_BASE + 'a-line.jpg',

  'Modified A-Line':
    IMAGE_BASE + 'modified-a-line.jpg',

  'Ball Gown':
    IMAGE_BASE + 'ball-gown.jpg',

  'Mermaid':
    IMAGE_BASE + 'mermaid.jpg',

  'Fit and Flare':
    IMAGE_BASE + 'fit-and-flare.jpg',

  'Trumpet':
    IMAGE_BASE + 'trumpet.jpg',

  'Sheath':
    IMAGE_BASE + 'sheath.jpg',

  'Empire':
    IMAGE_BASE + 'empire.jpg',

  'Tea Length':
    IMAGE_BASE + 'tea-length.jpg',

  'Mini':
    IMAGE_BASE + 'mini.jpg'
};

// ----------------------------------------------------
// STYLE NORMALIZATION
// Ensures AI output matches our image filenames.
// ----------------------------------------------------

function normalizeStyle(value) {
  const cleaned = String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  const aliases = {
    'a line': 'A-Line',
    'aline': 'A-Line',

    'modified a line': 'Modified A-Line',

    'ball gown': 'Ball Gown',
    'ballgown': 'Ball Gown',
    'princess': 'Ball Gown',

    'mermaid': 'Mermaid',

    'fit and flare': 'Fit and Flare',
    'fit flare': 'Fit and Flare',
    'fit and flare trumpet': 'Fit and Flare',

    'trumpet': 'Trumpet',

    'sheath': 'Sheath',
    'column': 'Sheath',

    'empire': 'Empire',
    'empire waist': 'Empire',

    'tea length': 'Tea Length',
    'tea length gown': 'Tea Length',

    'mini': 'Mini',
    'mini dress': 'Mini',
    'short': 'Mini'
  };

  return aliases[cleaned] || null;
}

// ----------------------------------------------------
// INPUT VALIDATION
// ----------------------------------------------------

function validateMeasurements(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const required = [
    'bust',
    'waist',
    'hips',
    'heightFeet',
    'heightInches'
  ];

  for (const field of required) {
    if (
      body[field] === undefined ||
      body[field] === null ||
      String(body[field]).trim() === ''
    ) {
      return null;
    }
  }

  const bust = Number(body.bust);
  const waist = Number(body.waist);
  const hips = Number(body.hips);
  const heightFeet = Number(body.heightFeet);
  const heightInches = Number(body.heightInches);

  const values = [
    bust,
    waist,
    hips,
    heightFeet,
    heightInches
  ];

  if (!values.every(Number.isFinite)) {
    return null;
  }

  if (
    bust <= 0 || bust > 120 ||
    waist <= 0 || waist > 120 ||
    hips <= 0 || hips > 120
  ) {
    return null;
  }

  if (
    !Number.isInteger(heightFeet) ||
    !Number.isInteger(heightInches) ||
    heightFeet < 0 ||
    heightFeet > 8 ||
    heightInches < 0 ||
    heightInches > 11 ||
    heightFeet * 12 + heightInches < 24
  ) {
    return null;
  }

  return {
    bust,
    waist,
    hips,
    heightFeet,
    heightInches
  };
}

// ----------------------------------------------------
// VERCEL API HANDLER
// ----------------------------------------------------

export default async function handler(req, res) {

  // ------------------------------------------------
  // 1. CORS
  // ------------------------------------------------

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

  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  // ------------------------------------------------
  // 2. VALIDATE CONFIGURATION
  // ------------------------------------------------

  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is missing');

    return res.status(500).json({
      error: 'Service configuration error'
    });
  }

  // ------------------------------------------------
  // 3. PROCESS RECOMMENDATION REQUEST
  // ------------------------------------------------

  try {

    const measurements =
      validateMeasurements(req.body);

    if (!measurements) {
      return res.status(400).json({
        error: 'Please provide valid measurements.'
      });
    }

    const {
      bust,
      waist,
      hips,
      heightFeet,
      heightInches
    } = measurements;

    const measurementText =
      `Bust: ${bust} inches; ` +
      `Waist: ${waist} inches; ` +
      `Hips: ${hips} inches; ` +
      `Height: ${heightFeet} feet ` +
      `${heightInches} inches.`;

    // ------------------------------------------------
    // 4. ASK OPENAI FOR RECOMMENDATIONS
    // ------------------------------------------------

    const availableStyles =
      Object.keys(STYLE_IMAGES).join(', ');

    const chat = await openai.chat.completions.create({

      model: TEXT_MODEL,

      temperature: 0.3,

      max_tokens: 100,

      messages: [
        {
          role: 'system',
          content:
            'You are an expert bridal stylist for ' +
            'Enchanted Gowns, a bridal boutique. ' +
            'Recommend wedding dress silhouettes ' +
            'using the provided body measurements. ' +
            'Focus on flattering proportions, ' +
            'comfort, and bridal elegance. ' +
            'Do not make negative body judgments. ' +
            'Only return styles from the approved list. ' +
            'Return exactly three distinct style names, ' +
            'one per line, without explanations.'
        },
        {
          role: 'user',
          content:
            `Bride measurements: ${measurementText}\n` +
            `Available styles: ${availableStyles}\n` +
            'Select the three most suitable styles. ' +
            'Return only their exact names, ' +
            'one per line. No numbering.'
        }
      ]
    });

    // ------------------------------------------------
    // 5. PARSE RECOMMENDATIONS
    // ------------------------------------------------

    const raw =
      chat.choices?.[0]?.message?.content || '';

    const lines = raw.split(/\r?\n/);

    const styles = [];

    for (const line of lines) {

      // Strip common list numbering and formatting.
      const cleaned = line
        .replace(/^\s*(?:[-*]|\d+[.)])\s*/, '')
        .replace(/\*/g, '')
        .trim();

      const canonical = normalizeStyle(cleaned);

      if (
        canonical &&
        STYLE_IMAGES[canonical] &&
        !styles.includes(canonical)
      ) {
        styles.push(canonical);
      }

      if (styles.length >= MAX_RECOMMENDATIONS) {
        break;
      }
    }

    // If the AI returned fewer than 3 valid styles,
    // supplement with broad traditional silhouettes.
    const fallbacks = [
      'A-Line',
      'Ball Gown',
      'Sheath'
    ];

    for (const fallback of fallbacks) {
      if (styles.length >= MAX_RECOMMENDATIONS) {
        break;
      }

      if (!styles.includes(fallback)) {
        styles.push(fallback);
      }
    }

    // ------------------------------------------------
    // 6. MATCH EXISTING IMAGE URLS
    // ------------------------------------------------

    const imageUrls = styles.map(style => {
      return STYLE_IMAGES[style] || null;
    });

    // ------------------------------------------------
    // 7. SEND RESULTS TO WORDPRESS
    // ------------------------------------------------

    console.log(
      'Recommendation completed:',
      styles.join(', ')
    );

    return res.status(200).json({

      recommendations: styles,

      images: imageUrls

    });

  } catch (error) {

    // ------------------------------------------------
    // 8. ERROR HANDLING
    // ------------------------------------------------

    console.error(
      'Style recommendation error:',
      error.message
    );

    return res.status(500).json({
      error: 'Unable to generate recommendations.'
    });

  }
}
