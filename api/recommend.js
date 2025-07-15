import { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Only POST allowed' });
    return;
  }

  const { bust, waist, hips, heightFeet, heightInches } = req.body;
  const measurementText = 
    `Bust: ${bust}"  Waist: ${waist}"  Hips: ${hips}"  Height: ${heightFeet}'${heightInches}"`;

  // 1) Get style recommendation
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

  // 2) Generate three images
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

  res.json({ recommendation, images: imageUrls });
}
