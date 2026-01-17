import React, { useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Mic2, Play, Download, Sparkles, Send, 
  User, Users, History, Volume2, 
  Wand2, Trash2, StopCircle
} from 'lucide-react';
import { GoogleGenAI, Modality } from "@google/genai";

// --- AUDIO UTILS ---
function pcmToWav(pcmData: Int16Array, sampleRate: number): Blob {
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
}

// --- CONSTANTS ---
const VOICES = [
  { id: 'Charon', name: 'Charon (Nam Trầm)', icon: '👨‍💼' },
  { id: 'Kore', name: 'Kore (Nam Ấm)', icon: '👨' },
  { id: 'Zephyr', name: 'Zephyr (Nữ Nhẹ)', icon: '👩' },
  { id: 'Aoede', name: 'Aoede (Nữ Trẻ)', icon: '👧' },
  { id: 'Puck', name: 'Puck (Vui Vẻ)', icon: '🧑' },
];

const App = () => {
  const [activeTab, setActiveTab] = useState<'single' | 'multi'>('single');
  const [text, setText] = useState('');
  const [voice, setVoice] = useState('Charon');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAiWriting, setIsAiWriting] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);

  const [speakers, setSpeakers] = useState([
    { id: 1, name: 'Paco', voice: 'Charon', text: '' },
    { id: 2, name: 'Mây', voice: 'Zephyr', text: '' },
  ]);

  const initAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
  };

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.stop();
      sourceNodeRef.current = null;
    }
    setIsPlaying(false);
  };

  const handleAiWrite = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiWriting(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Viết một đoạn tản văn ngắn hoặc lời thoại sâu sắc bằng tiếng Việt cho chủ đề: "${aiPrompt}". Hãy viết thật mượt mà và cảm xúc.`,
      });
      setText(response.text || "");
      setAiPrompt('');
    } catch (err) {
      console.error(err);
      alert("Lỗi AI Writer. Vui lòng kiểm tra kết nối.");
    } finally {
      setIsAiWriting(false);
    }
  };

  const handleGenerateTTS = async () => {
    const isSingle = activeTab === 'single';
    if (isSingle && !text.trim()) return;
    if (!isSingle && speakers.every(s => !s.text.trim())) return;

    setIsGenerating(true);
    stopAudio();
    initAudioContext();

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      let response;

      if (isSingle) {
        response = await ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
            },
          },
        });
      } else {
        const conversation = speakers.map(s => `${s.name}: ${s.text}`).join('\n');
        response = await ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text: `TTS conversation:\n${conversation}` }] }],
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
      if (base64Data) {
        const binary = atob(base64Data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        
        const pcmData = new Int16Array(bytes.buffer);
        const wavBlob = pcmToWav(pcmData, 24000);
        const wavUrl = URL.createObjectURL(wavBlob);

        const audioBuffer = audioContextRef.current!.createBuffer(1, pcmData.length, 24000);
        const channelData = audioBuffer.getChannelData(0);
        for (let i = 0; i < pcmData.length; i++) {
          channelData[i] = pcmData[i] / 32768.0;
        }

        const source = audioContextRef.current!.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContextRef.current!.destination);
        source.onended = () => setIsPlaying(false);
        source.start();
        sourceNodeRef.current = source;
        setIsPlaying(true);

        const newEntry = {
          id: Date.now(),
          title: isSingle ? text.substring(0, 30) : "Hội thoại đa giọng",
          url: wavUrl,
          type: activeTab
        };
        setHistory([newEntry, ...history]);
      }
    } catch (err) {
      console.error(err);
      alert("Lỗi tạo giọng nói. Hãy đảm bảo API Key hợp lệ.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-black rounded-2xl flex items-center justify-center text-white shadow-xl">
            <Mic2 size={24} />
          </div>
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tighter">Paco Studio</h1>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Premium Sound Space</p>
          </div>
        </div>

        <nav className="flex bg-white p-1 rounded-2xl shadow-sm border">
          <button 
            onClick={() => setActiveTab('single')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold uppercase transition-all ${activeTab === 'single' ? 'bg-black text-white shadow-lg' : 'text-slate-400'}`}
          >
            <User size={14} /> Đơn giọng
          </button>
          <button 
            onClick={() => setActiveTab('multi')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold uppercase transition-all ${activeTab === 'multi' ? 'bg-black text-white shadow-lg' : 'text-slate-400'}`}
          >
            <Users size={14} /> Đa giọng
          </button>
        </nav>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-6">
          <div className="glass-card rounded-[2.5rem] p-8 shadow-sm">
            {activeTab === 'single' ? (
              <div className="space-y-6">
                <div className="flex flex-wrap gap-2">
                  {VOICES.map(v => (
                    <button 
                      key={v.id}
                      onClick={() => setVoice(v.id)}
                      className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${voice === v.id ? 'bg-black text-white' : 'bg-white text-slate-500 hover:border-slate-300'}`}
                    >
                      {v.icon} {v.name.split(' ')[0]}
                    </button>
                  ))}
                </div>
                <textarea 
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Nhập nội dung bạn muốn Paco đọc..."
                  className="w-full h-80 bg-transparent border-none outline-none text-2xl leading-relaxed resize-none placeholder:text-slate-200"
                />
              </div>
            ) : (
              <div className="space-y-6 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                {speakers.map((s, idx) => (
                  <div key={s.id} className="p-6 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-4">
                    <div className="flex gap-4">
                      <input 
                        value={s.name}
                        onChange={(e) => {
                          const newS = [...speakers];
                          newS[idx].name = e.target.value;
                          setSpeakers(newS);
                        }}
                        className="bg-white px-4 py-1.5 rounded-lg text-xs font-bold border-none shadow-sm w-32"
                        placeholder="Tên..."
                      />
                      <select 
                        value={s.voice}
                        onChange={(e) => {
                          const newS = [...speakers];
                          newS[idx].voice = e.target.value;
                          setSpeakers(newS);
                        }}
                        className="bg-white px-4 py-1.5 rounded-lg text-xs font-bold border-none shadow-sm"
                      >
                        {VOICES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </div>
                    <textarea 
                      value={s.text}
                      onChange={(e) => {
                        const newS = [...speakers];
                        newS[idx].text = e.target.value;
                        setSpeakers(newS);
                      }}
                      className="w-full bg-white p-4 rounded-2xl border-none shadow-inner text-lg"
                      placeholder="Nhập lời thoại..."
                    />
                  </div>
                ))}
                <button 
                  onClick={() => setSpeakers([...speakers, { id: Date.now(), name: 'Người mới', voice: 'Charon', text: '' }])}
                  className="w-full py-4 border-2 border-dashed border-slate-200 rounded-3xl text-slate-300 font-bold text-xs uppercase hover:border-slate-400 transition-all"
                >
                  + Thêm người nói
                </button>
              </div>
            )}

            <div className="mt-8 pt-8 border-t flex gap-4">
              <button 
                onClick={handleGenerateTTS}
                disabled={isGenerating}
                className="flex-1 py-5 bg-black text-white rounded-3xl font-black text-xl shadow-2xl hover:bg-slate-800 transition-all disabled:opacity-50 flex items-center justify-center gap-3"
              >
                {isGenerating ? "ĐANG TẠO ÂM THANH..." : isPlaying ? "ĐANG PHÁT..." : <><Volume2 size={24} /> BẮT ĐẦU ĐỌC</>}
              </button>
              {isPlaying && (
                <button onClick={stopAudio} className="p-5 bg-red-50 text-red-600 rounded-3xl hover:bg-red-100 transition-all">
                  <StopCircle size={24} />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 space-y-8">
          <div className="glass-card rounded-[2rem] p-6 shadow-sm border-sky-100 bg-sky-50/20">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={18} className="text-sky-500" />
              <h3 className="text-xs font-black uppercase tracking-widest text-sky-700">Paco AI Writer</h3>
            </div>
            <div className="relative">
              <textarea 
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="Yêu cầu AI viết: 'Một bài thơ về mùa thu'..."
                className="w-full h-32 p-4 bg-white rounded-2xl border-none shadow-sm text-sm resize-none focus:ring-2 ring-sky-100 outline-none"
              />
              <button 
                onClick={handleAiWrite}
                disabled={isAiWriting}
                className="absolute bottom-3 right-3 p-2.5 bg-sky-600 text-white rounded-xl shadow-lg hover:bg-sky-700 transition-all"
              >
                {isAiWriting ? "..." : <Send size={18} />}
              </button>
            </div>
          </div>

          <div className="glass-card rounded-[2rem] p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <History size={18} className="text-slate-400" />
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Lịch sử</h3>
              </div>
              <button onClick={() => setHistory([])} className="text-slate-300 hover:text-red-500"><Trash2 size={16} /></button>
            </div>
            <div className="space-y-3">
              {history.length === 0 && (
                <p className="text-center py-8 text-xs text-slate-300 italic">Chưa có bản thu nào</p>
              )}
              {history.map(item => (
                <div key={item.id} className="flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-50 group hover:border-slate-200 transition-all">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center text-slate-400">
                      {item.type === 'single' ? <User size={14}/> : <Users size={14}/>}
                    </div>
                    <p className="text-sm font-bold text-slate-600 truncate w-32">{item.title || "Không có tên"}</p>
                  </div>
                  <a href={item.url} download={`paco-audio-${item.id}.wav`} className="p-2 text-slate-300 hover:text-black transition-colors">
                    <Download size={16} />
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <footer className="mt-20 py-8 border-t text-center">
        <p className="text-[10px] font-bold text-slate-300 uppercase tracking-[0.5em]">Paco Studio • Premium Audio Experience • 2024</p>
      </footer>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
