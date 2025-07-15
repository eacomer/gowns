import { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  // 1) CORS headers
  res.setHeader('Access-Control-Allow-Origin', 'https://enchantedgowns.com'); 
  // (or use '*' during testing, but lock down to your domain in prod)
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

  // 2) Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end(); // No content, but CORS headers sent
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  try {
    const { bust, waist, hips, heightFeet, heightInches } = req.body;
    const measurementText = 
      `Bust: ${bust}"  Waist: ${waist}"  Hips: ${hips}"  Height: ${heightFeet}'${heightInches}"`;

    // === your existing OpenAI calls ===
    const chat = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a high-end fashion stylist.' },
        { role: 'user', content:
            `Based on these measurements—${measurementText}—what dress style ` +
            `would best flatter this figure? Please name a single style (e.g. “A-line maxi”).`
        }
      ]
    });
    const recommendation = chat.choices[0].message.content.trim();

    const imgPromises = Array(3).fill().map(() =>
      openai.images.generate({
        model: 'dall-e-3',
        prompt: `Studio shot of a model wearing a ${recommendation} dress, full body, flattering lighting`,
        size: '1024x1024',
        n: 1
      })
    );
    const imgs = await Promise.all(imgPromises);
    const imageUrls = imgs.map(r => r.data[0].url);

    // 3) Return JSON with CORS headers in place
    res.status(200).json({ recommendation, images: imageUrls });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
