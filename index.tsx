import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Play, Download, Mic2, Sparkles, Trash2, 
  Headphones, Send, ChevronDown, 
  ArrowRightLeft, Key, X, History, Save, Settings, Info
} from 'lucide-react';
import { GoogleGenAI, Modality } from "@google/genai";

// --- TYPES ---
enum VoiceName {
  CHARON = 'Charon', KORE = 'Kore', ALGIEBA = 'Algieba', ZEPHYR = 'Zephyr', 
  AOEDE = 'Aoede', PUCK = 'Puck', FENRIR = 'Fenrir', ACHIRD = 'Achird', ENCELADUS = 'Enceladus',
}

interface AudioGeneration {
  id: string; text: string; voice: VoiceName; timestamp: number; audioBlob: Blob;
}

// --- UTILS ---
const getSavedApiKey = () => localStorage.getItem('PACO_API_KEY') || '';
const saveApiKey = (key: string) => localStorage.setItem('PACO_API_KEY', key);

// Decode raw base64 PCM to AudioBuffer
async function decodeAudioData(base64: string, ctx: AudioContext): Promise<AudioBuffer> {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  
  const dataInt16 = new Int16Array(bytes.buffer);
  const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < dataInt16.length; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }
  return buffer;
}

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; const bitDepth = 16;
  const blockAlign = (numChannels * bitDepth) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = buffer.length * blockAlign;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
  };
  writeString(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE'); writeString(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true); view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true); writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  const wavData = new Uint8Array(44 + dataSize);
  wavData.set(new Uint8Array(header));
  const pcmView = new DataView(wavData.buffer, 44);
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
      pcmView.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }
  return new Blob([wavData], { type: 'audio/wav' });
}

// --- DATA ---
const VOICES = [
  { id: VoiceName.CHARON, name: 'Charon (Trầm ấm)', icon: '🧔' },
  { id: VoiceName.KORE, name: 'Kore (Thân mật)', icon: '👨' },
  { id: VoiceName.ZEPHYR, name: 'Zephyr (Bay bổng)', icon: '🌬️' },
  { id: VoiceName.AOEDE, name: 'Aoede (Trẻ trung)', icon: '👧' },
  { id: VoiceName.PUCK, name: 'Puck (Vui vẻ)', icon: '🧑' },
  { id: VoiceName.FENRIR, name: 'Fenrir (Mạnh mẽ)', icon: '🐺' },
  { id: VoiceName.ACHIRD, name: 'Achird (Trí tuệ)', icon: '🧠' },
  { id: VoiceName.ENCELADUS, name: 'Enceladus (Nội tâm)', icon: '🌊' },
];

const EMOTIONS = ["Bình thản", "Hào hứng", "Buồn bã", "Nghiêm túc", "Thì thầm", "Kể chuyện"];

// --- APP ---
const App = () => {
  const [apiKey, setApiKey] = useState(getSavedApiKey());
  const [showKeyModal, setShowKeyModal] = useState(!getSavedApiKey());
  const [text, setText] = useState('');
  const [voice, setVoice] = useState<VoiceName>(VoiceName.CHARON);
  const [emotion, setEmotion] = useState('Bình thản');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [history, setHistory] = useState<AudioGeneration[]>([]);
  const [activeTab, setActiveTab] = useState<'single' | 'multi'>('single');
  const [multiSpeakers, setMultiSpeakers] = useState([
    { name: 'Paco', voice: VoiceName.CHARON, text: '' },
    { name: 'Bình Yên', voice: VoiceName.ZEPHYR, text: '' }
  ]);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'bot', text: string }[]>([]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const initAudio = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
  };

  const handleSaveKey = (e: React.FormEvent) => {
    e.preventDefault();
    const key = (e.target as any).elements.key.value;
    saveApiKey(key);
    setApiKey(key);
    setShowKeyModal(false);
  };

  const handleGenerate = async () => {
    if (!apiKey) { setShowKeyModal(true); return; }
    if (activeTab === 'single' && !text.trim()) return;
    
    setIsGenerating(true);
    try {
      initAudio();
      const ai = new GoogleGenAI({ apiKey });
      let base64 = "";

      if (activeTab === 'single') {
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text: `Say ${emotion}: ${text}` }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
          }
        });
        base64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
      } else {
        const prompt = `TTS the conversation:\n` + multiSpeakers.map(s => `${s.name}: ${s.text}`).join('\n');
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text: prompt }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: multiSpeakers.slice(0, 2).map(s => ({
                  speaker: s.name,
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voice } }
                }))
              }
            }
          }
        });
        base64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
      }

      if (base64) {
        const buffer = await decodeAudioData(base64, audioContextRef.current!);
        const wavBlob = audioBufferToWav(buffer);
        setHistory(prev => [{ id: Date.now().toString(), text: text.slice(0, 30) || 'Hội thoại', voice, timestamp: Date.now(), audioBlob: wavBlob }, ...prev]);
        
        if (sourceRef.current) sourceRef.current.stop();
        const source = audioContextRef.current!.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContextRef.current!.destination);
        source.onended = () => setIsPlaying(false);
        source.start(0);
        sourceRef.current = source;
        setIsPlaying(true);
      }
    } catch (err) {
      alert("Lỗi: Kiểm tra lại API Key hoặc nội dung văn bản.");
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAiWriter = async () => {
    if (!apiKey) { setShowKeyModal(true); return; }
    if (!aiPrompt.trim()) return;
    
    const prompt = aiPrompt;
    setChatHistory(prev => [...prev, { role: 'user', text: prompt }]);
    setAiPrompt('');
    setIsAiLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Bạn là trợ lý Paco Writer. Hãy viết nội dung tản văn hoặc lời thoại theo yêu cầu: "${prompt}". Văn bản hiện tại: "${text}". Hãy viết mượt mà, cảm xúc bằng tiếng Việt.`,
      });
      setChatHistory(prev => [...prev, { role: 'bot', text: response.text || "Không có phản hồi." }]);
    } catch (e) {
      setChatHistory(prev => [...prev, { role: 'bot', text: "Lỗi kết nối AI. Hãy kiểm tra API Key." }]);
    } finally {
      setIsAiLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between sticky top-0 z-40 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-white"><Mic2 size={20} /></div>
          <h1 className="text-xl font-black uppercase tracking-tighter">Paco Audio</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowKeyModal(true)} className="p-2.5 bg-slate-100 rounded-xl hover:bg-slate-200 transition-all">
            <Key size={20} className={apiKey ? "text-green-600" : "text-red-500"} />
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row p-4 md:p-8 gap-6 max-w-[1600px] mx-auto w-full">
        {/* Assistant Panel */}
        <div className="lg:w-1/3 flex flex-col bg-white border rounded-[2rem] shadow-xl overflow-hidden h-[600px] lg:h-auto">
          <div className="p-5 border-b bg-indigo-50/50 flex items-center justify-between">
            <span className="font-black text-xs uppercase tracking-widest text-indigo-700">Trợ lý Paco Writer</span>
            <Sparkles size={16} className="text-indigo-400" />
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar bg-[#fdfdfd]">
            {chatHistory.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center opacity-30 italic px-8">
                <Info size={32} className="mb-2" />
                <p className="text-sm">Nhập yêu cầu để Paco viết nội dung cho bạn</p>
              </div>
            )}
            {chatHistory.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-4 rounded-2xl text-lg ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-100'}`}>
                  {m.text}
                  {m.role === 'bot' && (
                    <button onClick={() => setText(m.text)} className="mt-3 flex items-center gap-2 text-[10px] font-black uppercase bg-white text-indigo-600 px-3 py-1.5 rounded-lg shadow-sm">Dùng bản thảo này</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="p-5 border-t bg-white relative">
            <textarea 
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              onKeyDown={e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiWriter(); } }}
              placeholder="Viết một tản văn về..." 
              className="w-full p-4 pr-14 bg-slate-50 border-none outline-none rounded-xl h-24 resize-none text-lg shadow-inner" 
            />
            <button 
              onClick={handleAiWriter}
              disabled={isAiLoading}
              className="absolute bottom-10 right-10 p-3 bg-indigo-600 text-white rounded-xl shadow-lg hover:scale-105 active:scale-95 transition-all"
            >
              {isAiLoading ? "..." : <Send size={20} />}
            </button>
          </div>
        </div>

        {/* Recording Room */}
        <div className="lg:w-2/3 flex flex-col gap-6">
          <div className="bg-white border rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden min-h-[600px]">
            <div className="peaceful-gradient p-10 flex flex-col md:flex-row justify-between items-center gap-6 border-b">
              <h2 className="text-5xl font-black italic tracking-tighter">Miền <span className="text-sky-700">Bình Yên</span></h2>
              <div className="flex bg-white/50 p-1.5 rounded-2xl border backdrop-blur-sm">
                <button onClick={() => setActiveTab('single')} className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'single' ? 'bg-white shadow-md text-sky-700' : 'text-slate-500'}`}>Đơn giọng</button>
                <button onClick={() => setActiveTab('multi')} className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'multi' ? 'bg-white shadow-md text-sky-700' : 'text-slate-500'}`}>Đa giọng</button>
              </div>
            </div>

            <div className="p-8 flex-1 flex flex-col gap-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4 bg-slate-50 p-2 rounded-2xl border">
                  <select 
                    value={voice} 
                    onChange={e => setVoice(e.target.value as VoiceName)}
                    className="bg-transparent font-black text-sm p-2 outline-none cursor-pointer"
                  >
                    {VOICES.map(v => <option key={v.id} value={v.id}>{v.icon} {v.name}</option>)}
                  </select>
                </div>
                <div className="flex bg-slate-100 p-1 rounded-xl border">
                  {EMOTIONS.slice(0, 4).map(emo => (
                    <button key={emo} onClick={() => setEmotion(emo)} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${emotion === emo ? 'bg-white shadow text-sky-700' : 'text-slate-400'}`}>
                      {emo}
                    </button>
                  ))}
                </div>
              </div>

              {activeTab === 'single' ? (
                <textarea 
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="Nhập nội dung bạn muốn nghe..." 
                  className="flex-1 w-full p-8 bg-slate-50 border-none outline-none rounded-[2rem] text-2xl leading-relaxed resize-none shadow-inner custom-scrollbar focus:bg-white focus:shadow-outline transition-all"
                />
              ) : (
                <div className="flex-1 space-y-4 overflow-y-auto pr-2 custom-scrollbar">
                  {multiSpeakers.map((s, idx) => (
                    <div key={idx} className="p-6 bg-slate-50 rounded-[2rem] border flex flex-col gap-4">
                      <div className="flex gap-3">
                        <input value={s.name} onChange={e => { const ns = [...multiSpeakers]; ns[idx].name = e.target.value; setMultiSpeakers(ns); }} className="px-4 py-2 rounded-xl border-none shadow-sm text-xs font-black w-32" />
                        <select value={s.voice} onChange={e => { const ns = [...multiSpeakers]; ns[idx].voice = e.target.value as VoiceName; setMultiSpeakers(ns); }} className="px-4 py-2 rounded-xl border-none shadow-sm text-xs font-black">
                          {VOICES.map(v => <option key={v.id} value={v.id}>{v.name.split(' ')[0]}</option>)}
                        </select>
                      </div>
                      <textarea value={s.text} onChange={e => { const ns = [...multiSpeakers]; ns[idx].text = e.target.value; setMultiSpeakers(ns); }} className="w-full p-4 rounded-xl border-none shadow-inner h-24 text-lg" placeholder="Lời thoại..." />
                    </div>
                  ))}
                  <button onClick={() => setMultiSpeakers([...multiSpeakers, { name: 'Người nói', voice: VoiceName.ZEPHYR, text: '' }])} className="w-full py-4 border-2 border-dashed border-slate-200 rounded-[2rem] text-slate-400 font-black uppercase text-[10px]">+ Thêm lời thoại</button>
                </div>
              )}

              <div className="pt-6 border-t flex gap-4">
                <button 
                  onClick={handleGenerate} 
                  disabled={isGenerating}
                  className="flex-1 py-6 bg-slate-900 text-white rounded-[2rem] font-black text-2xl shadow-2xl hover:bg-black active:scale-[0.98] transition-all disabled:opacity-50 animate-pulse-slow"
                >
                  {isGenerating ? "ĐANG XỬ LÝ..." : "BẮT ĐẦU ĐỌC VĂN BẢN"}
                </button>
                {isPlaying && (
                  <button onClick={() => { if(sourceRef.current) sourceRef.current.stop(); setIsPlaying(false); }} className="px-8 bg-red-50 text-red-600 rounded-[2rem] font-black text-sm shadow-sm border border-red-100">DỪNG</button>
                )}
              </div>
            </div>
          </div>

          {/* History */}
          <div className="bg-white p-8 rounded-[2.5rem] shadow-lg border">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400 flex items-center gap-2"><History size={16} /> Lịch sử lưu trữ</h3>
              <button onClick={() => setHistory([])} className="text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {history.length === 0 && <p className="col-span-full text-center py-10 opacity-20 italic font-bold text-xs uppercase tracking-widest">Trống</p>}
              {history.map(item => (
                <div key={item.id} className="p-4 bg-slate-50 rounded-2xl border flex flex-col gap-3 group hover:bg-slate-100 transition-all">
                  <p className="text-sm font-black text-slate-700 line-clamp-1">{item.text}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-slate-400 uppercase">{new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    <button 
                      onClick={() => {
                        const url = URL.createObjectURL(item.audioBlob);
                        const a = document.createElement('a'); a.href = url; a.download = `paco-${item.id}.wav`; a.click();
                      }}
                      className="p-2 bg-white rounded-lg shadow-sm text-slate-400 hover:text-sky-600 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Download size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* API Key Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 glass">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-10 border border-slate-100">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-2xl font-black uppercase tracking-tighter">Cài đặt API Key</h2>
              <button onClick={() => setShowKeyModal(false)} className="text-slate-400"><X size={24} /></button>
            </div>
            <p className="text-slate-500 mb-6 text-lg leading-relaxed">Bạn cần có <b>Google Gemini API Key</b> để sử dụng ứng dụng. Key này được lưu an toàn tại trình duyệt của bạn.</p>
            <form onSubmit={handleSaveKey} className="space-y-6">
              <input 
                name="key"
                defaultValue={apiKey}
                placeholder="Dán mã AIza... tại đây" 
                className="w-full p-5 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-indigo-100 outline-none text-xl shadow-inner font-mono"
              />
              <button className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black text-xl shadow-xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-3">
                <Save size={20} /> LƯU CẤU HÌNH
              </button>
              <a href="https://aistudio.google.com/app/apikey" target="_blank" className="block text-center text-xs font-black text-indigo-400 uppercase tracking-widest hover:text-indigo-600 transition-colors">Lấy Key miễn phí tại đây</a>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
