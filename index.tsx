import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Play, Download, Volume2, History, Mic2, Sparkles, Settings2, Trash2, 
  Users, Lock, Unlock, Headphones, Wand2, Send, ChevronDown, 
  MessageSquare, ArrowRightLeft, X 
} from 'lucide-react';
import { GoogleGenAI, Modality } from "@google/genai";

// --- TYPES & ENUMS ---
enum VoiceName {
  CHARON = 'Charon',
  KORE = 'Kore',
  ALGIEBA = 'Algieba',
  ZEPHYR = 'Zephyr',
  AOEDE = 'Aoede',
  PUCK = 'Puck',
  FENRIR = 'Fenrir',
  ACHIRD = 'Achird',
  ENCELADUS = 'Enceladus',
}

interface AudioGeneration {
  id: string;
  text: string;
  voice: VoiceName;
  timestamp: number;
  audioBlob: Blob;
}

// --- AUDIO UTILITIES ---
function decodeBase64(base64: string): Uint8Array {
  const binaryString = window.atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const blockAlign = (numChannels * bitDepth) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = buffer.length * blockAlign;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  const wavData = new Uint8Array(44 + dataSize);
  wavData.set(new Uint8Array(header));
  const pcmView = new DataView(wavData.buffer, 44);
  let offset = 0;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
      pcmView.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }
  return new Blob([wavData], { type: 'audio/wav' });
}

// --- GEMINI SERVICES ---
async function generateSpeech(text: string, voice: VoiceName, emotion: string, seed?: number): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: (window as any).process?.env?.API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY || process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `Say ${emotion}: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      seed: seed,
    },
  });
  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
}

async function generateMultiSpeakerSpeech(speakers: { name: string; voice: VoiceName; text: string }[], seed?: number): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: (window as any).process?.env?.API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY || process.env.API_KEY });
  const prompt = `TTS the following conversation:\n` + speakers.map(s => `${s.name}: ${s.text}`).join('\n');
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: speakers.slice(0, 2).map(s => ({
            speaker: s.name,
            voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voice } }
          }))
        }
      },
      seed: seed,
    },
  });
  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
}

// --- UI DATA ---
const VOICES = [
  { id: VoiceName.CHARON, name: 'Charon (Trầm ấm)', icon: '🧔', desc: 'Giọng nam trầm ấm, sâu lắng' },
  { id: VoiceName.KORE, name: 'Kore (Thân mật)', icon: '👨', desc: 'Giọng nam truyền cảm, gần gũi' },
  { id: VoiceName.ALGIEBA, name: 'Algieba (Hiện đại)', icon: '✨', desc: 'Chất giọng đặc biệt, mới lạ' },
  { id: VoiceName.ZEPHYR, name: 'Zephyr (Bay bổng)', icon: '🌬️', desc: 'Giọng nữ nhẹ nhàng, thanh thoát' },
  { id: VoiceName.AOEDE, name: 'Aoede (Trẻ trung)', icon: '👧', desc: 'Giọng nữ trong sáng, năng động' },
  { id: VoiceName.PUCK, name: 'Puck (Vui vẻ)', icon: '🧑', desc: 'Giọng trẻ trung, linh hoạt' },
  { id: VoiceName.FENRIR, name: 'Fenrir (Mạnh mẽ)', icon: '🐺', desc: 'Giọng nam uy lực, dứt khoát' },
  { id: VoiceName.ACHIRD, name: 'Achird (Trí tuệ)', icon: '🧠', desc: 'Giọng đọc thông minh, rành mạch' },
  { id: VoiceName.ENCELADUS, name: 'Enceladus (Nội tâm)', icon: '🌊', desc: 'Giọng đọc sâu sắc, truyền cảm' },
];

const EMOTIONS = ["Bình thản", "Hào hứng", "Buồn bã", "Nghiêm túc", "Thì thầm", "Kể chuyện"];

// --- MAIN APP COMPONENT ---
const App: React.FC = () => {
  const [text, setText] = useState('');
  const [voice, setVoice] = useState<VoiceName>(VoiceName.CHARON);
  const [emotion, setEmotion] = useState('Bình thản');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState<string | null>(null);
  const [history, setHistory] = useState<AudioGeneration[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState<'single' | 'multi'>('single');
  const [isVoiceDropdownOpen, setIsVoiceDropdownOpen] = useState(false);
  const [isAssistantVisible, setIsAssistantVisible] = useState(true);
  const [volume, setVolume] = useState(100);
  const [speed, setSpeed] = useState(1.0);
  const [isConsistent, setIsConsistent] = useState(true);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'bot'; text: string }[]>([]);
  const [multiSpeakers, setMultiSpeakers] = useState([
    { name: 'Paco', voice: VoiceName.CHARON, text: '' },
    { name: 'Bình Yên', voice: VoiceName.ZEPHYR, text: '' }
  ]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), [chatHistory]);
  useEffect(() => {
    const handleClick = (e: MouseEvent) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsVoiceDropdownOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const initAudio = () => { if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 }); };

  const handleAiWriter = async () => {
    if (!aiPrompt.trim()) return;
    const userMsg = aiPrompt;
    setChatHistory(prev => [...prev, { role: 'user', text: userMsg }]);
    setAiPrompt('');
    setIsAiLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Trợ lý Paco Writer. Yêu cầu: ${userMsg}. Văn bản hiện tại: ${text}. Hãy viết/sửa lại mượt mà nhất.`,
      });
      setChatHistory(prev => [...prev, { role: 'bot', text: response.text || "" }]);
    } catch (e) { setChatHistory(prev => [...prev, { role: 'bot', text: "Lỗi kết nối Gemini." }]); }
    finally { setIsAiLoading(false); }
  };

  const playAudio = (buffer: AudioBuffer) => {
    if (!audioContextRef.current) return;
    stopAudio();
    const source = audioContextRef.current.createBufferSource();
    const gainNode = audioContextRef.current.createGain();
    source.buffer = buffer;
    source.playbackRate.value = speed;
    gainNode.gain.value = volume / 100;
    source.connect(gainNode);
    gainNode.connect(audioContextRef.current.destination);
    source.onended = () => { if (currentSourceRef.current === source) setIsPlaying(false); };
    setIsPlaying(true);
    source.start(0);
    currentSourceRef.current = source;
    gainNodeRef.current = gainNode;
  };

  const stopAudio = () => { if (currentSourceRef.current) { try { currentSourceRef.current.stop(); } catch(e) {} currentSourceRef.current = null; } setIsPlaying(false); };

  const handleGenerate = async () => {
    if (!text.trim() && activeTab === 'single') return;
    setIsGenerating(true);
    try {
      initAudio();
      const seed = isConsistent ? 42 : undefined;
      const base64 = activeTab === 'single' ? await generateSpeech(text, voice, emotion, seed) : await generateMultiSpeakerSpeech(multiSpeakers, seed);
      const buffer = await decodeAudioData(decodeBase64(base64), audioContextRef.current!, 24000, 1);
      const wavBlob = audioBufferToWav(buffer);
      setHistory(prev => [{ id: Date.now().toString(), text: activeTab === 'single' ? text.substring(0, 50) : 'Hội thoại', voice, timestamp: Date.now(), audioBlob: wavBlob }, ...prev]);
      playAudio(buffer);
    } catch (e) { alert("Lỗi tạo giọng nói."); }
    finally { setIsGenerating(false); }
  };

  const handlePreview = async (vId: VoiceName) => {
    if (isPreviewing) return;
    setIsPreviewing(vId);
    try {
      initAudio();
      const pText = text.trim() ? text.slice(0, 150) : `Chào bạn, tôi là giọng đọc ${vId}.`;
      const base64 = await generateSpeech(pText, vId, emotion, 42);
      playAudio(await decodeAudioData(decodeBase64(base64), audioContextRef.current!, 24000, 1));
    } finally { setIsPreviewing(null); }
  };

  const selectedVoiceObj = VOICES.find(v => v.id === voice) || VOICES[0];

  return (
    <div className="min-h-screen flex flex-col bg-[#fcfcfc]">
      <header className="bg-white border-b border-slate-100 sticky top-0 z-50 px-8 py-4 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-slate-900 text-white rounded-xl flex items-center justify-center"><Mic2 size={20} /></div>
          <h1 className="text-2xl font-black uppercase tracking-tighter">Paco Audio</h1>
        </div>
        <button onClick={() => setIsAssistantVisible(!isAssistantVisible)} className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold shadow-sm">
          {isAssistantVisible ? 'Ẩn Trợ Lý' : 'Hiện Trợ Lý Gemini'}
        </button>
      </header>

      <main className="flex-1 max-w-[1600px] mx-auto w-full p-6 md:p-10 grid grid-cols-1 lg:grid-cols-12 gap-10">
        {isAssistantVisible && (
          <div className="lg:col-span-5 flex flex-col h-[calc(100vh-180px)] bg-white rounded-[2rem] shadow-xl border border-slate-100 overflow-hidden">
            <div className="p-6 bg-indigo-50/30 border-b border-slate-100 font-black text-slate-800">TRỢ LÝ PACO WRITER</div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
              {chatHistory.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] p-4 rounded-2xl ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-100'}`}>
                    <p className="text-lg leading-relaxed">{msg.text}</p>
                    {msg.role === 'bot' && <button onClick={() => setText(msg.text)} className="mt-2 text-[10px] font-black uppercase bg-white text-indigo-600 px-3 py-1 rounded-lg">Chuyển vào trình đọc</button>}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="p-6 border-t border-slate-100 relative">
              <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiWriter(); } }} placeholder="Yêu cầu viết/sửa..." className="w-full p-4 pr-14 rounded-xl bg-slate-50 border-none outline-none h-24 resize-none" />
              <button onClick={handleAiWriter} disabled={isAiLoading} className="absolute bottom-10 right-10 p-3 bg-indigo-600 text-white rounded-xl shadow-lg">{isAiLoading ? "..." : <Send size={18} />}</button>
            </div>
          </div>
        )}

        <div className={`${isAssistantVisible ? 'lg:col-span-7' : 'lg:col-span-12'} space-y-8`}>
          <div className="bg-white rounded-[2rem] shadow-xl border border-slate-100 overflow-hidden">
            <div className="peaceful-gradient p-8 flex flex-col md:flex-row justify-between items-center gap-8">
              <h2 className="text-4xl font-black text-slate-900 italic">Miền <span className="text-sky-700">Bình Yên</span></h2>
              <div className="bg-white/80 p-6 rounded-2xl shadow-sm border border-white flex gap-6">
                <div className="space-y-2"><p className="text-[10px] font-black text-slate-400 uppercase">Âm lượng {volume}%</p><input type="range" value={volume} onChange={e => setVolume(Number(e.target.value))} className="w-32 accent-sky-600" /></div>
                <div className="space-y-2"><p className="text-[10px] font-black text-slate-400 uppercase">Tốc độ {speed}x</p><input type="range" min="0.5" max="2" step="0.1" value={speed} onChange={e => setSpeed(Number(e.target.value))} className="w-32 accent-sky-600" /></div>
              </div>
            </div>
            <div className="p-8 space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex bg-slate-100 p-1 rounded-xl">
                  <button onClick={() => setActiveTab('single')} className={`px-6 py-2 rounded-lg text-xs font-bold ${activeTab === 'single' ? 'bg-white shadow text-sky-700' : 'text-slate-500'}`}>Đơn giọng</button>
                  <button onClick={() => setActiveTab('multi')} className={`px-6 py-2 rounded-lg text-xs font-bold ${activeTab === 'multi' ? 'bg-white shadow text-sky-700' : 'text-slate-500'}`}>Đa giọng</button>
                </div>
                <div className="relative" ref={dropdownRef}>
                  <button onClick={() => setIsVoiceDropdownOpen(!isVoiceDropdownOpen)} className="flex items-center gap-3 px-4 py-2 bg-slate-50 border rounded-xl text-sm font-black w-56 text-left">
                    <span>{selectedVoiceObj.icon}</span><span className="flex-1 truncate">{selectedVoiceObj.name}</span><ChevronDown size={14} />
                  </button>
                  {isVoiceDropdownOpen && (
                    <div className="absolute top-full mt-2 left-0 w-full bg-white border rounded-xl shadow-2xl z-[60] max-h-60 overflow-y-auto custom-scrollbar">
                      {VOICES.map(v => (
                        <div key={v.id} onClick={() => {setVoice(v.id); setIsVoiceDropdownOpen(false);}} className="p-3 hover:bg-slate-50 flex items-center justify-between cursor-pointer">
                          <span className="text-sm font-bold">{v.icon} {v.name}</span>
                          <button onClick={e => {e.stopPropagation(); handlePreview(v.id);}} className="p-1.5 bg-slate-100 rounded-lg"><Headphones size={14} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {activeTab === 'single' ? (
                <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Nhập văn bản..." className="w-full h-80 p-8 rounded-2xl bg-slate-50 text-2xl leading-relaxed outline-none border-2 border-transparent focus:border-sky-100 focus:bg-white transition-all shadow-inner" />
              ) : (
                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                  {multiSpeakers.map((s, idx) => (
                    <div key={idx} className="bg-slate-50 p-6 rounded-2xl border flex flex-col gap-4">
                      <div className="flex gap-4">
                        <input value={s.name} onChange={e => { const ns = [...multiSpeakers]; ns[idx].name = e.target.value; setMultiSpeakers(ns); }} className="px-3 py-1.5 rounded-lg border text-xs font-bold" />
                        <select value={s.voice} onChange={e => { const ns = [...multiSpeakers]; ns[idx].voice = e.target.value as VoiceName; setMultiSpeakers(ns); }} className="px-3 py-1.5 rounded-lg border text-xs font-bold">
                          {VOICES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                        </select>
                      </div>
                      <textarea value={s.text} onChange={e => { const ns = [...multiSpeakers]; ns[idx].text = e.target.value; setMultiSpeakers(ns); }} className="w-full p-4 rounded-xl border bg-white text-lg h-24" />
                    </div>
                  ))}
                  <button onClick={() => setMultiSpeakers([...multiSpeakers, { name: 'Nhân vật', voice: VoiceName.ZEPHYR, text: '' }])} className="w-full py-4 border-2 border-dashed rounded-2xl text-slate-400 font-bold uppercase text-xs">+ Thêm phân đoạn</button>
                </div>
              )}
              <div className="flex items-center gap-4 pt-6">
                <button onClick={handleGenerate} disabled={isGenerating} className="flex-1 py-5 bg-slate-900 text-white rounded-2xl font-black text-xl shadow-xl hover:bg-black disabled:opacity-50">{isGenerating ? "ĐANG TẠO..." : "BẮT ĐẦU ĐỌC"}</button>
                {isPlaying && <button onClick={stopAudio} className="w-20 h-20 bg-red-50 text-red-600 rounded-2xl font-black text-xs border border-red-100">DỪNG</button>}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);
