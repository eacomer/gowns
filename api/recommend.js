// api/recommend.js

import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://enchantedgowns.com');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { bust, waist, hips, heightFeet, heightInches } = req.body;
    const measurementText =
      `Bust: ${bust}" Waist: ${waist}" Hips: ${hips}" Height: ${heightFeet}'${heightInches}"`;

    // Ask for up to 3 wedding dress styles
    const chat = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are an expert bridal stylist.' },
        {
          role: 'user',
          content:
            `Based on these measurements—${measurementText}—please recommend up to ` +
            `three wedding dress styles that would best flatter this figure. ` +
            `List each style on its own line.`
        }
      ]
    });

    // Parse styles (take up to 3 lines)
    const raw = chat.choices[0].message.content.trim();
    const styles = raw
      .split(/\r?\n/)
      .map(s => s.replace(/^[\d\.\-\)\s]*/, '').trim())
      .filter(s => s)
      .slice(0, 3);

    // Generate one wedding-dress image per style
    const images = await Promise.all(
      styles.map(style =>
        openai.images.generate({
          model: 'dall-e-3',
          prompt: `Studio shot of a model wearing a ${style} wedding dress, full body, flattering lighting`,
          size: '1024x1024',
          n: 1
        })
      )
    );
    const imageUrls = images.map(r => r.data[0].url);

    return res.status(200).json({
      recommendations: styles,
      images: imageUrls
    });

  } catch (err) {
    console.error('recommend.js error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
