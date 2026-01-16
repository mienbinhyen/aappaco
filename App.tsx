import React, { useState, useRef, useEffect } from 'react';
import { 
  Play, 
  Download, 
  Volume2, 
  History, 
  Mic2, 
  Sparkles, 
  Settings2,
  Trash2,
  Users,
  Lock,
  Unlock,
  Headphones,
  Wand2,
  Send,
  ChevronDown,
  Copy,
  PenLine,
  CheckCircle2,
  X,
  MessageSquare,
  ChevronRight
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { VoiceName, AudioGeneration } from './types';
import { generateSpeech, generateMultiSpeakerSpeech } from './geminiService';
import { decodeBase64, decodeAudioData, audioBufferToWav } from './audioUtils';

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

const EMOTIONS = [
  "Bình thản", "Hào hứng", "Buồn bã", "Nghiêm túc", "Thì thầm", "Kể chuyện"
];

const App: React.FC = () => {
  const [text, setText] = useState('');
  const [voice, setVoice] = useState<VoiceName>(VoiceName.CHARON);
  const [emotion, setEmotion] = useState('Bình thản');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState<string | null>(null);
  const [history, setHistory] = useState<AudioGeneration[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState<'single' | 'multi'>('single');
  
  // UI State
  const [isVoiceDropdownOpen, setIsVoiceDropdownOpen] = useState(false);
  const [showAiAssistant, setShowAiAssistant] = useState(false);
  
  // Audio settings
  const [volume, setVolume] = useState(100);
  const [speed, setSpeed] = useState(1.0);
  const [isConsistent, setIsConsistent] = useState(true);
  
  // AI Assistant state
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiDraft, setAiDraft] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'bot'; text: string }[]>([]);

  // Multi-speaker state
  const [multiSpeakers, setMultiSpeakers] = useState([
    { name: 'Paco', voice: VoiceName.CHARON, text: '' },
    { name: 'Bình Yên', voice: VoiceName.ZEPHYR, text: '' }
  ]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsVoiceDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume / 100;
    }
  }, [volume]);

  useEffect(() => {
    if (currentSourceRef.current) {
      currentSourceRef.current.playbackRate.value = speed;
    }
  }, [speed]);

  const initAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
  };

  const handleAiWriter = async () => {
    if (!aiPrompt.trim()) return;
    const userMsg = aiPrompt;
    setChatHistory(prev => [...prev, { role: 'user', text: userMsg }]);
    setAiPrompt('');
    setIsAiLoading(true);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Bạn là Paco Writer. Yêu cầu: ${userMsg}. Văn bản hiện tại: ${text}. Hãy trả về văn bản đã chỉnh sửa hoặc viết mới một cách truyền cảm nhất.`,
      });
      const botMsg = response.text || "Xin lỗi, tôi không thể xử lý yêu cầu.";
      setChatHistory(prev => [...prev, { role: 'bot', text: botMsg }]);
      setAiDraft(botMsg);
    } catch (error) {
      console.error(error);
      setChatHistory(prev => [...prev, { role: 'bot', text: "Lỗi kết nối Gemini." }]);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handlePreview = async (selectedVoice: VoiceName) => {
    if (isPreviewing) return;
    setIsPreviewing(selectedVoice);
    try {
      initAudioContext();
      // Use current text for realistic preview
      const previewText = text.trim() ? text.slice(0, 200) : `Chào bạn, tôi là giọng đọc ${selectedVoice}. Hãy nhập văn bản để tôi đọc thử nhé.`;
      const base64 = await generateSpeech(previewText, selectedVoice, emotion, 42);
      const bytes = decodeBase64(base64);
      const buffer = await decodeAudioData(bytes, audioContextRef.current!, 24000, 1);
      playAudio(buffer);
    } catch (error) {
      console.error(error);
    } finally {
      setIsPreviewing(null);
    }
  };

  const handleGenerate = async () => {
    if (!text.trim() && activeTab === 'single') return;
    setIsGenerating(true);
    try {
      initAudioContext();
      const seed = isConsistent ? 42 : undefined;
      let base64;
      if (activeTab === 'single') {
        base64 = await generateSpeech(text, voice, emotion, seed);
      } else {
        base64 = await generateMultiSpeakerSpeech(multiSpeakers, seed);
      }
      const bytes = decodeBase64(base64);
      const buffer = await decodeAudioData(bytes, audioContextRef.current!, 24000, 1);
      const wavBlob = audioBufferToWav(buffer);
      const newGen: AudioGeneration = {
        id: Date.now().toString(),
        text: activeTab === 'single' ? (text.length > 50 ? text.substring(0, 50) + '...' : text) : 'Hội thoại đa giọng nói',
        voice: voice,
        timestamp: Date.now(),
        audioBlob: wavBlob
      };
      setHistory(prev => [newGen, ...prev]);
      playAudio(buffer);
    } catch (error) {
      console.error(error);
      alert("Đã xảy ra lỗi.");
    } finally {
      setIsGenerating(false);
    }
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

  const stopAudio = () => {
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch(e) {}
      currentSourceRef.current = null;
    }
    setIsPlaying(false);
  };

  const updateMultiSpeaker = (index: number, field: string, value: any) => {
    const newSpeakers = [...multiSpeakers];
    newSpeakers[index] = { ...newSpeakers[index], [field]: value };
    setMultiSpeakers(newSpeakers);
  };

  const selectedVoiceObj = VOICES.find(v => v.id === voice) || VOICES[0];

  return (
    <div className="min-h-screen flex flex-col bg-[#f9fafb]">
      {/* Header - Simple and Elegant */}
      <header className="bg-white border-b border-slate-100 sticky top-0 z-[60] px-8 py-5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center text-white shadow-xl rotate-3">
              <span className="text-2xl font-bold uppercase tracking-tighter">P</span>
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-slate-900 uppercase leading-none">Paco</h1>
              <p className="font-serif-accent text-sky-600 text-lg tracking-wide">Miền Bình Yên</p>
            </div>
          </div>
          
          <button 
            onClick={() => setShowAiAssistant(true)}
            className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl text-sm font-bold shadow-lg hover:bg-indigo-700 transition-all active:scale-95"
          >
            <Sparkles size={18} /> Soạn thảo với Gemini
          </button>
        </div>
      </header>

      {/* Gemini Chat Overlay - Full Width Style */}
      {showAiAssistant && (
        <div className="fixed inset-0 z-[100] flex justify-center items-center bg-slate-900/40 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="w-full max-w-5xl bg-white h-[90vh] rounded-[3rem] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-500">
            <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-indigo-50/30">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg">
                  <Wand2 size={24} />
                </div>
                <div>
                  <h2 className="text-2xl font-black text-slate-800">Paco Assistant</h2>
                  <p className="text-xs font-bold text-indigo-500 uppercase tracking-widest mt-1">Hỗ trợ viết & chỉnh sửa bài viết</p>
                </div>
              </div>
              <button onClick={() => setShowAiAssistant(false)} className="p-3 hover:bg-white rounded-full transition-all shadow-sm">
                <X size={28} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-10 space-y-6 custom-scrollbar bg-[#fdfdfd]">
              {chatHistory.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-30">
                  <MessageSquare size={80} className="mb-6 text-indigo-300" />
                  <p className="text-2xl font-bold italic">Bắt đầu hội thoại với Paco để viết nên câu chuyện của bạn</p>
                </div>
              )}
              {chatHistory.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] p-6 rounded-3xl ${msg.role === 'user' ? 'bg-indigo-600 text-white shadow-xl' : 'bg-white border border-slate-100 text-slate-800 shadow-lg'}`}>
                    <p className="text-lg leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                    {msg.role === 'bot' && (
                      <div className="mt-4 flex gap-3">
                        <button 
                          onClick={() => { setText(msg.text); setShowAiAssistant(false); }}
                          className="flex items-center gap-2 text-xs font-black uppercase bg-indigo-50 text-indigo-700 px-4 py-2 rounded-xl hover:bg-indigo-100 transition-all"
                        >
                          <Copy size={14} /> Dùng văn bản này
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <div className="p-8 border-t border-slate-100 bg-white">
              <div className="relative max-w-4xl mx-auto">
                <textarea 
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiWriter(); } }}
                  placeholder="Viết yêu cầu của bạn (Enter để gửi)..."
                  className="w-full p-6 pr-20 rounded-[2rem] bg-slate-50 border-2 border-transparent focus:border-indigo-200 outline-none resize-none h-32 transition-all text-lg shadow-inner"
                />
                <button 
                  onClick={handleAiWriter}
                  disabled={isAiLoading || !aiPrompt.trim()}
                  className="absolute bottom-6 right-6 p-4 bg-indigo-600 text-white rounded-[1.5rem] shadow-xl hover:bg-indigo-700 disabled:opacity-50 transition-all active:scale-90"
                >
                  {isAiLoading ? <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <Send size={24} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-7xl mx-auto w-full p-6 md:p-12 grid grid-cols-1 lg:grid-cols-12 gap-12">
        
        {/* Editor Main Section */}
        <div className="lg:col-span-8 space-y-10">
          <div className="bg-white rounded-[3rem] shadow-2xl border border-slate-50 overflow-hidden">
            <div className="peaceful-gradient p-10 flex flex-col md:flex-row items-center justify-between gap-10">
              <div className="text-center md:text-left">
                <h2 className="text-5xl font-black text-slate-900 leading-tight">Góc nhỏ <br/><span className="text-sky-700 italic font-serif-accent">Bình Yên</span></h2>
                <p className="text-slate-500 text-xl mt-4 font-serif-accent italic">"Nơi ngôn từ tìm thấy hơi ấm"</p>
              </div>
              
              <div className="bg-white/80 backdrop-blur-lg p-8 rounded-[2.5rem] shadow-xl border border-white flex flex-col gap-6 min-w-[340px]">
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-widest text-slate-400 px-1">
                    <span>Âm lượng</span>
                    <span className="text-sky-600">{volume}%</span>
                  </div>
                  <input type="range" min="0" max="100" value={volume} onChange={(e) => setVolume(parseInt(e.target.value))} className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-sky-600" />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-widest text-slate-400 px-1">
                    <span>Tốc độ đọc</span>
                    <span className="text-sky-600">{speed}x</span>
                  </div>
                  <input type="range" min="0.5" max="2.0" step="0.1" value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-sky-600" />
                </div>
              </div>
            </div>

            <div className="p-10 space-y-8">
              {/* Tab Selector & Science-based controls */}
              <div className="flex flex-wrap items-center justify-between gap-6">
                <div className="flex bg-slate-100 p-1.5 rounded-[1.2rem] shadow-inner">
                  <button onClick={() => setActiveTab('single')} className={`flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'single' ? 'bg-white shadow-md text-sky-700' : 'text-slate-500'}`}><Mic2 size={18} /> Đơn giọng</button>
                  <button onClick={() => setActiveTab('multi')} className={`flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'multi' ? 'bg-white shadow-md text-sky-700' : 'text-slate-500'}`}><Users size={18} /> Đa giọng</button>
                </div>

                <div className="flex items-center gap-3">
                  <button onClick={() => setIsConsistent(!isConsistent)} className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-[10px] font-black uppercase transition-all border shadow-sm ${isConsistent ? 'bg-sky-50 border-sky-100 text-sky-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                    {isConsistent ? <Lock size={14} /> : <Unlock size={14} />} Đồng bộ
                  </button>
                  <div className="flex bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
                    {EMOTIONS.slice(0, 4).map(emo => (
                      <button key={emo} onClick={() => setEmotion(emo)} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${emotion === emo ? 'bg-sky-600 text-white shadow-md' : 'text-slate-400'}`}>
                        {emo}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {activeTab === 'single' ? (
                <div className="relative group">
                  <textarea 
                    value={text} 
                    onChange={(e) => setText(e.target.value)} 
                    placeholder="Hãy viết câu chuyện của bạn vào đây..." 
                    className="w-full h-[450px] p-10 rounded-[2.5rem] bg-slate-50 border-2 border-transparent focus:border-sky-100 focus:bg-white text-slate-800 placeholder-slate-300 resize-none outline-none text-3xl leading-relaxed shadow-inner transition-all"
                  />
                  <div className="absolute bottom-8 right-10 text-[11px] font-black text-slate-400 uppercase tracking-widest bg-white/60 px-5 py-2 rounded-full border border-white backdrop-blur-sm">
                    {text.length} Ký tự
                  </div>
                </div>
              ) : (
                <div className="space-y-6 max-h-[600px] overflow-y-auto pr-4 custom-scrollbar">
                  {multiSpeakers.map((speaker, idx) => (
                    <div key={idx} className="bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100 space-y-6 group">
                      <div className="flex items-center gap-6">
                        <input value={speaker.name} onChange={(e) => updateMultiSpeaker(idx, 'name', e.target.value)} className="font-bold text-slate-700 bg-white border border-slate-200 px-5 py-2.5 rounded-2xl text-xs w-40 outline-none shadow-sm" placeholder="Tên" />
                        <select value={speaker.voice} onChange={(e) => updateMultiSpeaker(idx, 'voice', e.target.value as VoiceName)} className="bg-white border border-slate-200 px-5 py-2.5 rounded-2xl text-xs font-bold text-slate-600 outline-none cursor-pointer shadow-sm">
                          {VOICES.map(v => <option key={v.id} value={v.id}>{v.icon} {v.name.split(' (')[0]}</option>)}
                        </select>
                        {multiSpeakers.length > 2 && <button onClick={() => setMultiSpeakers(multiSpeakers.filter((_, i) => i !== idx))} className="ml-auto text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"><Trash2 size={22} /></button>}
                      </div>
                      <textarea value={speaker.text} onChange={(e) => updateMultiSpeaker(idx, 'text', e.target.value)} placeholder="Nhập lời thoại..." className="w-full h-32 p-6 rounded-2xl bg-white border border-slate-100 text-xl resize-none outline-none shadow-sm" />
                    </div>
                  ))}
                  <button onClick={() => setMultiSpeakers([...multiSpeakers, { name: 'Nhân vật', voice: VoiceName.ZEPHYR, text: '' }])} className="w-full py-6 border-2 border-dashed border-slate-200 rounded-[2.5rem] text-slate-400 hover:text-sky-600 hover:border-sky-200 transition-all text-sm font-black uppercase tracking-[0.4em]">+ Thêm phân đoạn</button>
                </div>
              )}

              {/* Main Action Bar */}
              <div className="flex items-center gap-6 pt-10 border-t border-slate-100">
                <button 
                  onClick={handleGenerate} 
                  disabled={isGenerating || (activeTab === 'single' && !text.trim())}
                  className="flex-1 flex items-center justify-center gap-4 py-6 bg-slate-900 text-white rounded-[2rem] font-black text-2xl shadow-2xl hover:bg-black active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  {isGenerating ? <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <Play size={32} fill="currentColor" />}
                  ĐỌC BÀI VIẾT
                </button>
                {isPlaying && (
                  <button onClick={stopAudio} className="w-24 h-24 bg-red-50 text-red-600 rounded-[2rem] font-black text-xs flex items-center justify-center hover:bg-red-100 transition-all animate-pulse">
                    DỪNG
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar Controls */}
        <div className="lg:col-span-4 space-y-10">
          
          {/* Voice Dropdown Selection Card */}
          <div className="bg-white p-10 rounded-[3rem] shadow-xl border border-slate-50">
            <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] mb-8 flex items-center gap-2">
              <Settings2 size={18} className="text-sky-600" /> Chọn giọng đọc
            </h3>
            
            <div className="relative" ref={dropdownRef}>
              <button 
                onClick={() => setIsVoiceDropdownOpen(!isVoiceDropdownOpen)}
                className="w-full flex items-center gap-5 p-6 bg-slate-50 rounded-[2rem] border-2 border-transparent hover:border-sky-100 transition-all text-left shadow-inner group"
              >
                <div className="w-16 h-16 bg-slate-900 text-white rounded-2xl flex items-center justify-center text-3xl shadow-xl shrink-0 transition-transform group-hover:scale-105">
                  {selectedVoiceObj.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xl font-black text-slate-800 truncate">{selectedVoiceObj.name}</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter truncate mt-1">{selectedVoiceObj.desc}</p>
                </div>
                <ChevronDown className={`text-slate-400 transition-transform duration-500 ${isVoiceDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {isVoiceDropdownOpen && (
                <div className="absolute top-[110%] left-0 w-full bg-white rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-slate-100 z-[70] overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300 max-h-[500px] overflow-y-auto custom-scrollbar">
                  {VOICES.map((v) => (
                    <div 
                      key={v.id} 
                      className={`flex items-center gap-4 p-5 hover:bg-slate-50 transition-all cursor-pointer border-b border-slate-50 last:border-0 ${voice === v.id ? 'bg-sky-50/50' : ''}`}
                    >
                      <button onClick={() => { setVoice(v.id); setIsVoiceDropdownOpen(false); }} className="flex-1 flex items-center gap-4 text-left">
                        <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-2xl shrink-0 shadow-sm">{v.icon}</div>
                        <div>
                          <p className={`text-base font-black ${voice === v.id ? 'text-sky-800' : 'text-slate-700'}`}>{v.name}</p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter mt-0.5">{v.desc}</p>
                        </div>
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handlePreview(v.id); }} 
                        disabled={isPreviewing !== null}
                        className={`p-3 rounded-2xl transition-all shadow-sm ${isPreviewing === v.id ? 'bg-sky-600 text-white animate-pulse' : 'bg-slate-100 text-slate-400 hover:text-sky-600'}`}
                        title="Nghe thử với nội dung hiện tại"
                      >
                        <Headphones size={20} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="mt-10 p-6 bg-sky-50 rounded-2xl border border-sky-100">
               <p className="text-[11px] font-bold text-sky-800 flex items-center gap-2">
                 <Sparkles size={14} /> Gợi ý từ Paco
               </p>
               <p className="text-[11px] text-sky-600 mt-2 leading-relaxed italic">
                 Dùng biểu tượng <Headphones size={12} className="inline" /> để nghe Paco đọc thử bằng chính nội dung bạn đang soạn thảo.
               </p>
            </div>
          </div>

          {/* History Management */}
          <div className="bg-white p-10 rounded-[3rem] shadow-xl border border-slate-50 flex flex-col max-h-[450px]">
             <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] mb-8 flex items-center gap-2">
              <History size={18} className="text-sky-600" /> Bản lưu gần nhất
            </h3>
            <div className="flex-1 overflow-y-auto space-y-4 pr-3 custom-scrollbar">
              {history.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-20 py-20 italic">
                  <p className="font-black uppercase tracking-[0.2em] text-xs">Nhật ký đang trống</p>
                </div>
              ) : (
                history.map((item) => (
                  <div key={item.id} className="group bg-slate-50 hover:bg-slate-100 transition-all p-5 rounded-[1.5rem] border border-transparent hover:border-slate-200">
                    <p className="text-sm font-black text-slate-700 line-clamp-1 mb-4">{item.text}</p>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-xl bg-white shadow-sm flex items-center justify-center text-lg">{VOICES.find(v => v.id === item.voice)?.icon}</span>
                        <span className="text-[11px] font-black text-slate-400 uppercase tracking-tighter">{new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                      </div>
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">
                        <button onClick={() => {
                          if (!item.audioBlob) return;
                          const url = URL.createObjectURL(item.audioBlob);
                          const a = document.createElement('a'); a.href = url; a.download = `paco-${item.id}.wav`; a.click();
                        }} className="p-2.5 bg-white text-slate-400 hover:text-sky-600 rounded-xl shadow-sm"><Download size={18} /></button>
                        <button onClick={() => setHistory(history.filter(h => h.id !== item.id))} className="p-2.5 bg-white text-slate-400 hover:text-red-500 rounded-xl shadow-sm"><Trash2 size={18} /></button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className="bg-white border-t border-slate-100 py-20 px-10">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-12">
          <div className="text-center md:text-left">
            <div className="flex items-center gap-4 justify-center md:justify-start mb-6">
              <div className="w-10 h-10 bg-slate-900 text-white rounded-xl flex items-center justify-center">
                <Play size={20} fill="white" />
              </div>
              <span className="text-2xl font-black uppercase tracking-tighter text-slate-900">Paco Studio</span>
            </div>
            <p className="text-slate-400 text-xs font-black uppercase tracking-[0.3em]">© 2024 MIỀN BÌNH YÊN. Powered by Gemini TTS.</p>
            <p className="font-serif-accent text-slate-300 text-2xl mt-4">Nơi ngôn từ tìm thấy bến đỗ bình yên</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-16">
            <a href="#" className="text-slate-400 hover:text-sky-700 text-xs font-black uppercase tracking-[0.4em] transition-colors">Điều khoản</a>
            <a href="#" className="text-slate-400 hover:text-sky-700 text-xs font-black uppercase tracking-[0.4em] transition-colors">Bảo mật</a>
            <a href="#" className="text-slate-400 hover:text-sky-700 text-xs font-black uppercase tracking-[0.4em] transition-colors">Liên hệ</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;