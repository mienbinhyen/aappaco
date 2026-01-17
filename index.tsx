import React, { useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Mic, Sparkles, Send, History, 
  User, Users, Download, Play, 
  Pause, Trash2, Volume2, Coffee,
  Plus, X, Headphones
} from 'lucide-react';
import { GoogleGenAI, Modality } from "@google/genai";

// --- AUDIO UTILITIES ---
const decodeBase64 = (base64: string) => {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

const pcmToWav = (pcmData: Int16Array, sampleRate: number) => {
  const buffer = new ArrayBuffer(44 + pcmData.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 32 + pcmData.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, pcmData.length * 2, true);
  for (let i = 0; i < pcmData.length; i++) {
    view.setInt16(44 + i * 2, pcmData[i], true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
};

const VOICES = [
  { id: 'Charon', name: 'Nam Trầm', icon: '🌲' },
  { id: 'Kore', name: 'Nam Ấm', icon: '☀️' },
  { id: 'Zephyr', name: 'Nữ Nhẹ', icon: '🍃' },
  { id: 'Aoede', name: 'Nữ Trẻ', icon: '🌸' },
  { id: 'Puck', name: 'Vui Vẻ', icon: '🎈' },
];

interface Speaker {
  id: string;
  name: string;
  voice: string;
  text: string;
}

interface AudioRecord {
  id: number;
  title: string;
  url: string;
}

const App = () => {
  const [activeTab, setActiveTab] = useState<'single' | 'multi'>('single');
  const [singleText, setSingleText] = useState('');
  const [singleVoice, setSingleVoice] = useState('Zephyr');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAiWriting, setIsAiWriting] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [history, setHistory] = useState<AudioRecord[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);

  const [speakers, setSpeakers] = useState<Speaker[]>([
    { id: '1', name: 'Người kể', voice: 'Charon', text: '' },
    { id: '2', name: 'Bạn nhỏ', voice: 'Zephyr', text: '' },
  ]);

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch(e) {}
      sourceNodeRef.current = null;
    }
    setIsPlaying(false);
  };

  const addSpeaker = () => {
    const newId = Date.now().toString();
    setSpeakers([...speakers, { 
      id: newId, 
      name: `Nhân vật ${speakers.length + 1}`, 
      voice: VOICES[speakers.length % VOICES.length].id, 
      text: '' 
    }]);
  };

  const removeSpeaker = (id: string) => {
    if (speakers.length <= 1) return;
    setSpeakers(speakers.filter(s => s.id !== id));
  };

  const updateSpeaker = (id: string, field: keyof Speaker, value: string) => {
    setSpeakers(speakers.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const handleAiWrite = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiWriting(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const prompt = activeTab === 'single' 
        ? `Viết một đoạn văn ngắn khoảng 100 chữ về chủ đề: "${aiPrompt}". Văn phong nhẹ nhàng, sâu sắc.`
        : `Viết một kịch bản đối thoại ngắn giữa ${speakers.map(s => s.name).join(' và ')} về chủ đề: "${aiPrompt}". Hãy trình bày theo định dạng "Tên: Lời thoại".`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });

      const result = response.text || "";
      if (activeTab === 'single') {
        setSingleText(result);
      } else {
        const lines = result.split('\n').filter(l => l.includes(':'));
        if (lines.length > 0) {
          const newSpeakers = [...speakers];
          lines.forEach((line, i) => {
            if (i < newSpeakers.length) {
              const content = line.split(':').slice(1).join(':').trim();
              newSpeakers[i].text = content;
            }
          });
          setSpeakers(newSpeakers);
        } else {
          // Fallback if formatting is weird
          setSpeakers(speakers.map((s, i) => i === 0 ? {...s, text: result} : s));
        }
      }
      setAiPrompt('');
    } catch (err) {
      console.error(err);
      alert("AI hiện không thể phản hồi. Thử lại sau nhé!");
    } finally {
      setIsAiWriting(false);
    }
  };

  const handleGenerateTTS = async () => {
    const isSingle = activeTab === 'single';
    if (isSingle && !singleText.trim()) return;
    if (!isSingle && speakers.every(s => !s.text.trim())) return;

    setIsGenerating(true);
    stopAudio();

    if (!audioContextRef.current) {
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
    }

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      let response;

      if (isSingle) {
        response = await ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text: singleText }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: singleVoice } },
            },
          },
        });
      } else {
        const conversation = speakers
          .filter(s => s.text.trim())
          .map(s => `${s.name}: ${s.text}`)
          .join('\n');

        response = await ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text: conversation }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: speakers.map(s => ({
                  speaker: s.name,
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voice } }
                }))
              }
            }
          }
        });
      }

      const base64Data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Data && audioContextRef.current) {
        const bytes = decodeBase64(base64Data);
        const pcmData = new Int16Array(bytes.buffer);
        const wavBlob = pcmToWav(pcmData, 24000);
        const wavUrl = URL.createObjectURL(wavBlob);

        const buffer = audioContextRef.current.createBuffer(1, pcmData.length, 24000);
        const channelData = buffer.getChannelData(0);
        for (let i = 0; i < pcmData.length; i++) {
          channelData[i] = pcmData[i] / 32768.0;
        }

        const source = audioContextRef.current.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContextRef.current.destination);
        source.onended = () => setIsPlaying(false);
        source.start();
        sourceNodeRef.current = source;
        setIsPlaying(true);

        const title = isSingle 
          ? singleText.substring(0, 20) + "..." 
          : `Hội thoại ${speakers.length} người`;

        setHistory(prev => [{ id: Date.now(), title, url: wavUrl }, ...prev]);
      }
    } catch (err) {
      console.error(err);
      alert("Lỗi khi tạo giọng nói. Vui lòng kiểm tra nội dung kịch bản.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-12 md:py-16">
      {/* Header */}
      <header className="flex flex-col items-center mb-12 space-y-3">
        <div className="w-16 h-16 bg-emerald-500 text-white rounded-[2rem] flex items-center justify-center shadow-lg shadow-emerald-100 rotate-6 transform hover:rotate-0 transition-all duration-500">
          <Headphones size={30} />
        </div>
        <div className="text-center">
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Paco Audio</h1>
          <p className="text-emerald-500 font-bold tracking-[0.4em] text-[10px] uppercase mt-1">Miền Bình Yên</p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        {/* Editor Main Section */}
        <div className="lg:col-span-8 space-y-8">
          <div className="zen-card p-8 md:p-10">
            {/* Nav Tabs */}
            <div className="flex bg-slate-100/50 p-1 rounded-[2rem] mb-10 w-fit mx-auto lg:mx-0">
              <button 
                onClick={() => setActiveTab('single')}
                className={`flex items-center gap-2 px-8 py-3 rounded-[1.8rem] text-xs font-bold transition-all duration-300 ${activeTab === 'single' ? 'tab-active' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <User size={14} /> Độc thoại
              </button>
              <button 
                onClick={() => setActiveTab('multi')}
                className={`flex items-center gap-2 px-8 py-3 rounded-[1.8rem] text-xs font-bold transition-all duration-300 ${activeTab === 'multi' ? 'tab-active' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <Users size={14} /> Hội thoại
              </button>
            </div>

            {activeTab === 'single' ? (
              <div className="space-y-8 animate-in fade-in duration-500">
                <div className="flex flex-wrap gap-2.5">
                  {VOICES.map(v => (
                    <button 
                      key={v.id}
                      onClick={() => setSingleVoice(v.id)}
                      className={`px-5 py-2 rounded-full text-[11px] font-bold border transition-all ${singleVoice === v.id ? 'bg-emerald-500 border-emerald-500 text-white shadow-md' : 'bg-white border-slate-100 text-slate-400 hover:border-emerald-200 hover:text-emerald-500'}`}
                    >
                      {v.icon} {v.name}
                    </button>
                  ))}
                </div>
                <textarea 
                  value={singleText}
                  onChange={(e) => setSingleText(e.target.value)}
                  placeholder="Hôm nay tâm hồn bạn muốn nói điều gì?..."
                  className="w-full h-80 bg-transparent border-none outline-none text-xl text-slate-600 leading-relaxed resize-none placeholder:text-slate-200 font-medium"
                />
              </div>
            ) : (
              <div className="space-y-6 max-h-[600px] overflow-y-auto pr-3 custom-scrollbar animate-in slide-in-from-bottom-4 duration-500">
                {speakers.map((s, idx) => (
                  <div key={s.id} className="p-8 bg-slate-50/50 rounded-[2.5rem] border border-white relative group hover:bg-white/90 transition-all duration-300">
                    <button 
                      onClick={() => removeSpeaker(s.id)}
                      className="absolute top-4 right-4 p-2 bg-white text-slate-300 hover:text-rose-500 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={14} />
                    </button>
                    
                    <div className="flex flex-wrap items-center gap-4 mb-6">
                      <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-2xl shadow-sm border border-slate-50">
                        <User size={12} className="text-emerald-500" />
                        <input 
                          value={s.name}
                          onChange={(e) => updateSpeaker(s.id, 'name', e.target.value)}
                          className="bg-transparent border-none outline-none text-[11px] font-bold text-slate-700 w-24"
                          placeholder="Tên..."
                        />
                      </div>
                      <select 
                        value={s.voice}
                        onChange={(e) => updateSpeaker(s.id, 'voice', e.target.value)}
                        className="bg-white px-4 py-2 rounded-2xl shadow-sm text-[11px] font-bold text-slate-500 outline-none border border-slate-50 cursor-pointer"
                      >
                        {VOICES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </div>
                    
                    <textarea 
                      value={s.text}
                      onChange={(e) => updateSpeaker(s.id, 'text', e.target.value)}
                      className="w-full bg-white/40 p-5 rounded-3xl border-none shadow-inner text-lg text-slate-600 outline-none focus:bg-white transition-all font-medium"
                      placeholder="Lời nhân vật kể lại..."
                    />
                  </div>
                ))}
                
                <button 
                  onClick={addSpeaker}
                  className="w-full py-6 border-2 border-dashed border-emerald-100 text-emerald-300 hover:border-emerald-300 hover:text-emerald-500 rounded-[2.5rem] flex items-center justify-center gap-2 transition-all duration-300 font-bold text-xs"
                >
                  <Plus size={18} /> THÊM NHÂN VẬT MỚI
                </button>
              </div>
            )}

            {/* Main Generation Buttons */}
            <div className="mt-12 pt-8 border-t border-slate-50 flex flex-col sm:flex-row gap-4">
              <button 
                onClick={handleGenerateTTS}
                disabled={isGenerating}
                className={`flex-1 py-5 rounded-[2.5rem] font-bold text-lg shadow-xl flex items-center justify-center gap-3 transition-all active:scale-95 ${isGenerating ? 'bg-slate-100 text-slate-400' : 'bg-slate-800 text-white hover:bg-slate-700 shadow-slate-200'}`}
              >
                {isGenerating ? (
                  <div className="flex items-center gap-2 generating-status">
                    <Volume2 size={22} className="animate-pulse" />
                    <span>ĐANG KHỞI TẠO ÂM THANH...</span>
                  </div>
                ) : isPlaying ? (
                  <><Pause size={22} /> ĐANG PHÁT...</>
                ) : (
                  <><Mic size={22} /> BẮT ĐẦU CHUYỂN GIỌNG</>
                )}
              </button>
              
              {isPlaying && (
                <button 
                  onClick={stopAudio} 
                  className="px-8 py-5 bg-rose-50 text-rose-500 rounded-[2.5rem] hover:bg-rose-500 hover:text-white transition-all flex items-center justify-center shadow-lg shadow-rose-100"
                >
                  <X size={24} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar Sections */}
        <div className="lg:col-span-4 space-y-8">
          {/* AI Creative Assistant */}
          <div className="zen-card p-8 bg-emerald-500/5 border-emerald-100/50">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-emerald-500 rounded-xl text-white shadow-lg shadow-emerald-100">
                <Sparkles size={16} />
              </div>
              <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-700">Trợ lý kịch bản AI</h3>
            </div>
            <div className="relative group">
              <textarea 
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="Ví dụ: Viết một cuộc trò chuyện giữa gió và mây về sự tự do..."
                className="w-full h-40 p-6 bg-white rounded-[2rem] border border-emerald-50 shadow-sm text-sm text-slate-600 resize-none focus:ring-4 ring-emerald-100/50 outline-none transition-all placeholder:text-slate-200"
              />
              <button 
                onClick={handleAiWrite}
                disabled={isAiWriting}
                className="absolute bottom-4 right-4 w-12 h-12 bg-emerald-600 text-white rounded-2xl shadow-xl flex items-center justify-center hover:bg-emerald-700 transition-all active:scale-90 disabled:opacity-50"
              >
                {isAiWriting ? (
                  <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                ) : (
                  <Send size={18} />
                )}
              </button>
            </div>
          </div>

          {/* Records History */}
          <div className="zen-card p-8">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <History size={16} className="text-slate-400" />
                <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Bản ghi gần đây</h3>
              </div>
              {history.length > 0 && (
                <button 
                  onClick={() => setHistory([])} 
                  className="p-1 text-slate-200 hover:text-rose-400 transition-all"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            
            <div className="space-y-4 max-h-96 overflow-y-auto pr-1 custom-scrollbar">
              {history.length === 0 ? (
                <div className="text-center py-16 opacity-10">
                  <Mic size={32} className="mx-auto mb-3" />
                  <p className="text-[10px] font-bold uppercase tracking-[0.3em]">Trống</p>
                </div>
              ) : (
                history.map(item => (
                  <div key={item.id} className="flex items-center justify-between p-5 bg-white rounded-[1.8rem] border border-slate-50 hover:border-emerald-100 hover:shadow-sm transition-all group">
                    <div className="min-w-0 pr-4">
                      <p className="text-[11px] font-black text-slate-600 truncate mb-1 uppercase tracking-tight">{item.title}</p>
                      <span className="text-[8px] text-slate-300 font-bold uppercase tracking-widest">WAV • Mastered</span>
                    </div>
                    <a 
                      href={item.url} 
                      download={`paco-audio-${item.id}.wav`}
                      className="p-3 bg-slate-50 text-slate-400 hover:bg-emerald-500 hover:text-white rounded-xl transition-all active:scale-90"
                    >
                      <Download size={14} />
                    </a>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <footer className="mt-20 text-center pb-10">
        <div className="flex items-center justify-center gap-2 text-slate-200 mb-4 opacity-30">
          <div className="h-[1px] w-12 bg-slate-300"></div>
          <Coffee size={14} />
          <div className="h-[1px] w-12 bg-slate-300"></div>
        </div>
        <p className="text-[10px] font-black text-slate-200 uppercase tracking-[0.7em]">Tĩnh Lặng • Sáng Tạo • Paco</p>
      </footer>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
