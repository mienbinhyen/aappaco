
import { GoogleGenAI, Modality } from "@google/genai";
import { VoiceName } from "./types";

const API_KEY = process.env.API_KEY || "";

export const generateSpeech = async (
  text: string, 
  voice: VoiceName, 
  style: string = "trực tiếp",
  seed?: number
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  // Model specifically for Text-to-Speech tasks
  const modelName = 'gemini-2.5-flash-preview-tts';
  
  const prompt = style ? `Hãy nói bằng giọng ${style}: ${text}` : `Say: ${text}`;

  const response = await ai.models.generateContent({
    model: modelName,
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      seed: seed, // Providing a fixed seed ensures generation consistency
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error("Không nhận được dữ liệu âm thanh từ API.");
  }

  return base64Audio;
};

export const generateMultiSpeakerSpeech = async (
  speakers: { name: string; voice: VoiceName; text: string }[],
  seed?: number
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const modelName = 'gemini-2.5-flash-preview-tts';

  const conversation = speakers
    .map(s => `${s.name}: ${s.text}`)
    .join('\n');
    
  const prompt = `TTS the following conversation between speakers:\n${conversation}`;

  const response = await ai.models.generateContent({
    model: modelName,
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      seed: seed,
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: speakers.map(s => ({
            speaker: s.name,
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: s.voice }
            }
          }))
        }
      }
    }
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error("Không nhận được dữ liệu âm thanh đa giọng nói.");
  }

  return base64Audio;
};
