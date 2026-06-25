import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Mic, Volume2, AlertCircle, RefreshCw, Info } from "lucide-react";

type AppState = "IDLE" | "LISTENING" | "TRANSLATING" | "SPEAKING" | "ERROR";

export default function App() {
  const [state, setState] = useState<AppState>("IDLE");
  const [japaneseText, setJapaneseText] = useState<string>("");
  const [portugueseText, setPortugueseText] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [speechSpeed, setSpeechSpeed] = useState<number>(1.0); // 1.0 = Normal, 0.8 = Slowly
  
  const recognitionRef = useRef<any>(null);
  const isLoopActiveRef = useRef<boolean>(false);
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Keep latest mutable values in refs to prevent stale closure issues in the single stable recognition instance
  const stateRef = useRef<AppState>("IDLE");
  const speedRef = useRef<number>(1.0);
  const dialectRef = useRef<string>("pt-BR");

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    speedRef.current = speechSpeed;
  }, [speechSpeed]);

  // Safe helper to start recognition
  const startListening = () => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.start();
    } catch (e) {
      // Ignore if already started
    }
  };

  // Safe helper to stop recognition
  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (e) {
        // Ignore errors when aborting
      }
    }
  };

  // Helper to restart listening with a slight delay
  const restartListeningWithDelay = () => {
    setTimeout(() => {
      if (isLoopActiveRef.current) {
        startListening();
      }
    }, 300);
  };

  // Translate Japanese to Portuguese using server API, then read aloud
  const translateAndSpeak = async (text: string) => {
    setState("TRANSLATING");
    setPortugueseText("");

    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "翻訳に失敗しました");
      }

      const data = await response.json();
      const translation = data.translation;
      setPortugueseText(translation);

      // Speak translation
      speakText(translation);
    } catch (error: any) {
      console.error("Translation failed:", error);
      setState("ERROR");
      setErrorMessage(error.message || "ネットワークエラーが発生しました。");
      isLoopActiveRef.current = false;
    }
  };

  // Speak Portuguese text using SpeechSynthesis
  const speakText = (text: string) => {
    setState("SPEAKING");

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = dialectRef.current;
    utterance.rate = speedRef.current;

    // Find suitable Portuguese voice
    const voices = window.speechSynthesis.getVoices();
    const ptVoice =
      voices.find((v) => v.lang.toLowerCase() === dialectRef.current.toLowerCase()) ||
      voices.find((v) => v.lang.startsWith("pt"));

    if (ptVoice) {
      utterance.voice = ptVoice;
    }

    utterance.onend = () => {
      currentUtteranceRef.current = null;
      if (isLoopActiveRef.current) {
        setState("LISTENING");
        startListening();
      } else {
        setState("IDLE");
      }
    };

    utterance.onerror = (err) => {
      console.error("Speech synthesis error:", err);
      currentUtteranceRef.current = null;
      if (isLoopActiveRef.current) {
        setState("LISTENING");
        startListening();
      } else {
        setState("IDLE");
      }
    };

    currentUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  };

  // Initialize Speech Recognition EXACTLY ONCE on mount
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setState("ERROR");
      setErrorMessage("お使いのブラウザは音声認識に対応していません。Google Chromeなどの最新のブラウザをお試しください。");
      return;
    }

    const rec = new SpeechRecognition();
    rec.lang = "ja-JP";
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      setState("LISTENING");
    };

    rec.onresult = async (event: any) => {
      const transcript = event.results[0][0].transcript;
      if (!transcript || transcript.trim() === "") return;

      setJapaneseText(transcript);
      translateAndSpeak(transcript);
    };

    rec.onerror = (event: any) => {
      console.warn("Speech recognition error:", event.error);
      
      if (event.error === "no-speech") {
        if (isLoopActiveRef.current) {
          restartListeningWithDelay();
        } else {
          setState("IDLE");
        }
      } else if (event.error === "not-allowed") {
        setState("ERROR");
        setErrorMessage("マイクの使用が許可されていません。ブラウザの設定でマイクへのアクセスを許可してください。");
        isLoopActiveRef.current = false;
      } else {
        if (isLoopActiveRef.current) {
          restartListeningWithDelay();
        } else {
          setState("IDLE");
        }
      }
    };

    rec.onend = () => {
      if (isLoopActiveRef.current && stateRef.current === "LISTENING") {
        restartListeningWithDelay();
      }
    };

    recognitionRef.current = rec;

    // Cleanup on unmount
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {}
      }
      window.speechSynthesis.cancel();
    };
  }, []);

  // Toggle Translation Engine (Start/Stop Loop)
  const handleToggleLoop = () => {
    if (state === "ERROR" && errorMessage.includes("ブラウザ")) {
      return; // Cannot recover if unsupported
    }

    if (isLoopActiveRef.current) {
      isLoopActiveRef.current = false;
      stopListening();
      window.speechSynthesis.cancel();
      setState("IDLE");
    } else {
      isLoopActiveRef.current = true;
      setErrorMessage("");

      const unlockUtterance = new SpeechSynthesisUtterance("");
      unlockUtterance.volume = 0;
      window.speechSynthesis.speak(unlockUtterance);

      setState("LISTENING");
      startListening();
    }
  };

  // Let voices load on standard Chrome/Safari events
  useEffect(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.getVoices();
    }
  }, []);

  // Quick reset
  const handleReset = () => {
    isLoopActiveRef.current = false;
    stopListening();
    window.speechSynthesis.cancel();
    setJapaneseText("");
    setPortugueseText("");
    setErrorMessage("");
    setState("IDLE");
  };

  return (
    <div className="min-h-screen w-full bg-[#020308] text-white flex flex-col items-center justify-between p-4 sm:p-8 relative overflow-hidden font-sans select-none">
      
      {/* Immersive ambient glowing backdrop */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] sm:w-[800px] sm:h-[800px] bg-[#0044ff] opacity-[0.08] blur-[140px] sm:blur-[180px] rounded-full" />
        
        {/* State-based glowing light */}
        <AnimatePresence>
          {state === "LISTENING" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.15 }}
              exit={{ opacity: 0 }}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-cyan-500 blur-[120px] rounded-full"
            />
          )}
          {state === "TRANSLATING" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.15 }}
              exit={{ opacity: 0 }}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-amber-500 blur-[120px] rounded-full"
            />
          )}
          {state === "SPEAKING" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.15 }}
              exit={{ opacity: 0 }}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-rose-500 blur-[120px] rounded-full"
            />
          )}
        </AnimatePresence>
      </div>

      {/* Top Header & Prominent Input Controller Button */}
      <header className="z-10 w-full max-w-md flex flex-col items-center gap-4 pt-2">
        {/* Language labels */}
        <div className="w-full flex items-center justify-between opacity-30 px-2">
          <div className="flex-1 text-right tracking-[0.4em] text-[10px] uppercase font-bold">
            Japanese
          </div>
          <div className="flex items-center gap-2 px-4">
            <div className="w-1 h-1 bg-white rounded-full" />
            <div className="w-1 h-1 bg-white rounded-full opacity-50" />
            <div className="w-1 h-1 bg-white rounded-full opacity-20" />
          </div>
          <div className="flex-1 text-left tracking-[0.4em] text-[10px] uppercase font-bold">
            Portuguese
          </div>
        </div>

        {/* Input Controller Button at the absolute top (最上部) */}
        <button
          id="top-control-btn"
          onClick={handleToggleLoop}
          className={`group w-full max-w-sm py-4 px-6 rounded-2xl flex items-center justify-between transition-all duration-300 border cursor-pointer ${
            isLoopActiveRef.current
              ? "bg-cyan-950/40 border-cyan-500/50 shadow-[0_0_20px_rgba(34,211,238,0.15)]"
              : "bg-white/5 border-white/10 hover:bg-white/10"
          }`}
        >
          <div className="flex items-center gap-3">
            {/* Pulsing state light */}
            <div className="relative flex h-3 w-3">
              {isLoopActiveRef.current && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
              )}
              <span className={`relative inline-flex rounded-full h-3 w-3 ${
                state === "LISTENING"
                  ? "bg-cyan-400"
                  : state === "SPEAKING"
                  ? "bg-rose-400"
                  : state === "TRANSLATING"
                  ? "bg-amber-400"
                  : isLoopActiveRef.current
                  ? "bg-cyan-500"
                  : "bg-white/30"
              }`} />
            </div>

            <div className="text-left">
              <p className="text-[11px] font-black tracking-[0.15em] uppercase text-white/90">
                {isLoopActiveRef.current ? "音声自動翻訳: ON" : "音声自動翻訳: OFF"}
              </p>
              <p className="text-[9px] text-white/40 tracking-wider">
                {state === "LISTENING" && "日本語をききとっています..."}
                {state === "TRANSLATING" && "ポルトガル語に翻訳中..."}
                {state === "SPEAKING" && "ポルトガル語を再生中..."}
                {state === "IDLE" && (isLoopActiveRef.current ? "話しかけてください" : "タップして音声入力を開始")}
                {state === "ERROR" && "エラーが発生しました"}
              </p>
            </div>
          </div>

          {/* Inline mini audio visualizer or indicator */}
          <div className="flex items-end gap-1 h-6">
            {state === "LISTENING" ? (
              <>
                <div className="w-1 bg-cyan-400 rounded-full h-[50%] wave-bar-1" />
                <div className="w-1 bg-cyan-400 rounded-full h-[90%] wave-bar-2" />
                <div className="w-1 bg-cyan-400 rounded-full h-[40%] wave-bar-3" />
              </>
            ) : state === "SPEAKING" ? (
              <>
                <div className="w-1 bg-rose-400 rounded-full h-[40%] wave-bar-3" />
                <div className="w-1 bg-rose-400 rounded-full h-[90%] wave-bar-1" />
                <div className="w-1 bg-rose-400 rounded-full h-[50%] wave-bar-2" />
              </>
            ) : (
              <>
                <div className="w-1 bg-white/10 rounded-full h-[30%]" />
                <div className="w-1 bg-white/10 rounded-full h-[30%]" />
                <div className="w-1 bg-white/10 rounded-full h-[30%]" />
              </>
            )}
          </div>
        </button>
      </header>

      {/* Main Dynamic Workspace Area (Center is completely open and majestic!) */}
      <main className="z-10 w-full max-w-xl flex-1 flex flex-col items-center justify-center py-4">
        
        {/* Dynamic Voice Text Canvas */}
        <div className="w-full text-center flex flex-col items-center justify-center min-h-[300px] px-4">
          <AnimatePresence mode="wait">
            {state === "IDLE" && !japaneseText && (
              <motion.div
                key="idle-state"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex flex-col items-center max-w-md"
              >
                <div className="text-white/20 text-xl font-light mb-4 tracking-wide leading-relaxed">
                  「日本語で話しかけてください」
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-snug text-white/80">
                  ハンズフリー通訳
                </div>
                <div className="mt-6 w-32 h-[1px] bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                <p className="text-[10px] text-white/35 tracking-[0.2em] uppercase font-medium mt-4 text-center leading-relaxed">
                  上のボタンをオンにして、スマホを置いたまま<br />日本語で話しかけるだけで自動通訳されます。
                </p>
              </motion.div>
            )}

            {state === "ERROR" && errorMessage && (
              <motion.div
                key="error-state"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex flex-col items-center max-w-md gap-4"
              >
                <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold tracking-wider text-red-400 uppercase">エラー発生</h3>
                <p className="text-sm text-white/70 max-w-xs leading-relaxed">
                  {errorMessage}
                </p>
              </motion.div>
            )}

            {(japaneseText || portugueseText) && state !== "ERROR" && (
              <motion.div
                key="translation-data"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center w-full"
              >
                {/* Original Japanese */}
                {japaneseText && (
                  <motion.div 
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-white/35 text-xl sm:text-2xl font-light mb-8 tracking-tight max-w-lg leading-relaxed italic"
                  >
                    「 {japaneseText} 」
                  </motion.div>
                )}

                {/* Subdued Divider */}
                <div className="w-48 h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                {/* Large Brazilian Portuguese output */}
                <div className="mt-8 flex flex-col items-center w-full px-4">
                  {portugueseText ? (
                    <motion.p
                      initial={{ scale: 0.95, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", stiffness: 100 }}
                      className="text-4xl sm:text-6xl font-black tracking-tight leading-tight text-white drop-shadow-[0_0_50px_rgba(255,255,255,0.18)] max-w-lg text-center break-words"
                    >
                      {portugueseText}
                    </motion.p>
                  ) : (
                    <div className="flex items-center gap-3 text-cyan-400 text-xs tracking-[0.3em] font-bold uppercase animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                      TRANSLATING...
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Minimal Parameters Config */}
        <div className="w-full max-w-sm flex flex-col gap-4 mt-4">
          
          <div className="flex items-center justify-center gap-4 bg-white/[0.03] border border-white/5 p-3 rounded-2xl text-[11px]">
            {/* Speech rate */}
            <div className="flex items-center gap-2">
              <span className="text-white/40 font-medium">発音速度 / Velocidade:</span>
              <button
                onClick={() => setSpeechSpeed(speechSpeed === 1.0 ? 0.8 : 1.0)}
                className="bg-white/5 border border-white/10 px-3 py-1.5 rounded-xl text-white font-semibold hover:bg-white/10 hover:border-white/20 active:scale-95 transition"
              >
                {speechSpeed === 1.0 ? "標準 (1.0x)" : "ゆっくり (0.8x)"}
              </button>
            </div>
          </div>

          {/* Safe recovery controls */}
          {(japaneseText || portugueseText) && (
            <button
              onClick={handleReset}
              className="text-[10px] text-white/35 hover:text-white/60 tracking-wider transition flex items-center justify-center gap-1.5 py-1"
            >
              <RefreshCw className="w-3 h-3" />
              対話をクリアして最初から
            </button>
          )}

        </div>

      </main>

      {/* Subdued Footer Information */}
      <footer className="z-10 w-full max-w-md text-center flex flex-col items-center justify-center gap-2 pt-4">
        <div className="flex items-center justify-center gap-1.5 text-white/30 text-[10px] tracking-widest uppercase font-bold">
          <Info className="w-3 h-3 text-cyan-400" />
          Pure Voice Translation Engine • Direct Stream
        </div>
        <p className="text-[10px] text-white/20 max-w-xs leading-relaxed">
          最上部のボタンをONにするとマイク入力の待ち受けと、ポルトガル語の音声再生がハンズフリーで無限ループします。
        </p>
      </footer>

    </div>
  );
}
