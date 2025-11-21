import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Volume2, Activity } from 'lucide-react';

// --- Audio Engine Helper Constants ---
const AUDIO_CTX_OPTIONS = { sampleRate: 44100 };

// Initial preset parameters for the 8 sounds (Now only Blip and Noise)
const INITIAL_PRESETS = [
  // Slot 1
  { name: "SQUARE 1", type: 'blip', pitch: 0.4, decay: 0.2, color: 0.8, crush: 0.4 },
  // Slot 2
  { name: "BLIP A", type: 'blip', pitch: 0.9, decay: 0.3, color: 0.5, crush: 0.8 },
  // Slot 3
  { name: "NOISE A", type: 'noise', pitch: 0.5, decay: 0.5, color: 0.1, crush: 0.5 },
  // Slot 4: LASER (New)
  { name: "LASER", type: 'blip', pitch: 0.9, decay: 0.2, color: 0.7, crush: 0.4 },
  // Slot 5: Jump
  { name: "JUMP", type: 'blip', pitch: 1.0, decay: 0.1, color: 0.5, crush: 0.0 },
  // Slot 6: COIN (New)
  { name: "COIN", type: 'blip', pitch: 0.8, decay: 0.1, color: 0.5, crush: 0.2 },
  // Slot 7
  { name: "GLITCH", type: 'blip', pitch: 0.2, decay: 0.1, color: 0.9, crush: 1.0 },
  // Slot 8: EXPLODE (New)
  { name: "EXPLODE", type: 'noise', pitch: 0.4, decay: 0.8, color: 0.0, crush: 1.0 },
];

export default function PocketSampler() {
  // --- State ---
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [sounds, setSounds] = useState(INITIAL_PRESETS);
  const [masterVolume, setMasterVolume] = useState(0.8);
  const [isLoaded, setIsLoaded] = useState(false);

  // --- Refs for Audio ---
  const audioCtxRef = useRef(null);
  
  // Analyzer for Visuals
  const analyzerRef = useRef(null);
  const [visualData, setVisualData] = useState(new Uint8Array(16));
  const visualLoopRef = useRef(null);

  // --- Initialization ---
  useEffect(() => {
    const initAudio = async () => {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new AudioContext(AUDIO_CTX_OPTIONS);
      
      // Setup Analyzer
      const analyzer = audioCtxRef.current.createAnalyser();
      analyzer.fftSize = 64;
      analyzer.smoothingTimeConstant = 0.7;
      analyzerRef.current = analyzer;

      setIsLoaded(true);
    };
    initAudio();

    return () => {
      if (audioCtxRef.current) audioCtxRef.current.close();
      cancelAnimationFrame(visualLoopRef.current);
    };
  }, []);

  // --- Visualizer Loop ---
  useEffect(() => {
    if (!isLoaded) return;
    
    const loop = () => {
      if (analyzerRef.current) {
        const data = new Uint8Array(analyzerRef.current.frequencyBinCount);
        analyzerRef.current.getByteFrequencyData(data);
        // Downsample to 16 bars for the LCD
        const lowRes = new Uint8Array(16);
        for (let i = 0; i < 16; i++) {
            lowRes[i] = data[i] / 255 * 100; // Normalize 0-100
        }
        setVisualData(lowRes);
      }
      visualLoopRef.current = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(visualLoopRef.current);
  }, [isLoaded]);


  // --- Audio Synthesis Engine ---
  // Generates sounds on the fly based on parameters
  const playSound = useCallback((slotIndex) => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    
    // Unlock audio context if suspended (needed on first user interaction)
    if (ctx.state === 'suspended') {
        ctx.resume();
    }
    
    const sound = sounds[slotIndex];
    const t = ctx.currentTime;

    // Master Gain
    const masterGain = ctx.createGain();
    masterGain.gain.value = masterVolume;
    masterGain.connect(analyzerRef.current);
    analyzerRef.current.connect(ctx.destination);

    // Sound specific synthesis
    const osc = ctx.createOscillator();
    const noise = ctx.createBufferSource();
    const gainNode = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const shaper = ctx.createWaveShaper();

    // Connect graph based on type
    gainNode.connect(filter);
    filter.connect(shaper);
    shaper.connect(masterGain);

    // 1. PITCH Handling (0.0 - 1.0) maps to frequency
    let baseFreq = 100;
    if (sound.type === 'blip') baseFreq = 200 + (sound.pitch * 1000);
    if (sound.type === 'noise') baseFreq = 50 + (sound.pitch * 100);
    
    // Apply pitch envelope for video game effects (e.g., laser/coin sweep)
    if (slotIndex === 4 || slotIndex === 5) { // Laser or Coin
        osc.frequency.setValueAtTime(baseFreq * 2, t);
        osc.frequency.linearRampToValueAtTime(baseFreq * 0.5, t + 0.1); 
        osc.frequency.linearRampToValueAtTime(baseFreq, t + 0.2); 
    } else {
        osc.frequency.setValueAtTime(baseFreq, t);
    }

    // 2. NOISE Generation
    const bufferSize = ctx.sampleRate * 2; 
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    noise.buffer = buffer;

    // 3. FILTER (Color)
    if (sound.color < 0.5) {
        filter.type = 'lowpass';
        filter.frequency.value = 200 + (sound.color * 4000);
    } else {
        filter.type = 'highpass';
        filter.frequency.value = 500 + ((sound.color - 0.5) * 8000);
    }
    filter.Q.value = 1 + (sound.color * 5); // Add resonance

    // 4. DISTORTION (Crush)
    function makeDistortionCurve(amount) {
        const k = typeof amount === 'number' ? amount : 50,
        n_samples = 44100,
        curve = new Float32Array(n_samples),
        deg = Math.PI / 180;
        for (let i = 0; i < n_samples; ++i ) {
            let x = i * 2 / n_samples - 1;
            curve[i] = ( 3 + k ) * x * 20 * deg / ( Math.PI + k * Math.abs(x) );
        }
        return curve;
    }
    shaper.curve = makeDistortionCurve(sound.crush * 400);
    shaper.oversample = '4x';

    // 5. ENVELOPE (Decay)
    const decayTime = 0.1 + (sound.decay * 1.5); // 0.1s to 1.6s
    gainNode.gain.setValueAtTime(1, t);
    gainNode.gain.exponentialRampToValueAtTime(0.001, t + decayTime);

    // Start sources
    if (sound.type === 'blip') { // Only 'blip' uses the oscillator now
        osc.type = 'square';
        osc.connect(gainNode);
        osc.start(t);
        osc.stop(t + decayTime);
    } else if (sound.type === 'noise') {
        noise.connect(gainNode);
        noise.start(t);
        noise.stop(t + decayTime);
    }

    // Cleanup
    setTimeout(() => {
        masterGain.disconnect();
    }, decayTime * 1000 + 200);

  }, [sounds, masterVolume]);

  // --- Throttling Logic for Real-Time Feedback ---
  const lastCall = useRef(0);
  const THROTTLE_DELAY = 50; // Throttle to a max of 20 times per second (1000ms / 50ms)

  const throttledPlaySound = useCallback(() => {
    const now = Date.now();
    // Only play if the last call was longer ago than THROTTLE_DELAY
    if (now - lastCall.current > THROTTLE_DELAY) {
      lastCall.current = now;
      playSound(selectedSlot);
    }
  }, [playSound, selectedSlot]);


  // --- UI Handlers ---
  const updateParam = (param, value) => {
    const newSounds = [...sounds];
    newSounds[selectedSlot][param] = value;
    setSounds(newSounds);
  };


  // --- Slider Component (Replaces Knob) ---
  const RangeInput = ({ label, value, onChange, colorClass = "text-lime-400" }) => {
    // Increased target size for touch and high contrast colors
    return (
      <div className="flex flex-col items-center gap-1 w-full relative"> 
        <span className={`text-xs sm:text-sm font-mono uppercase text-white mb-3 ${colorClass}`}>{label}</span>
        
        <input 
            type="range"
            min="0"
            max="1"
            step="0.001" // Changed to 0.001 for 1000 steps (more gradual control)
            value={value}
            onChange={(e) => {
                const newValue = parseFloat(e.target.value);
                onChange(newValue); // 1. Update the state (param)
                throttledPlaySound(); // 2. Play the sound with the new param
            }}
            // Increased height for easier touch targeting
            className="w-full h-4 sm:h-5 bg-zinc-800 rounded-xl appearance-none cursor-pointer 
                       // Large, bright thumb (Changed to w-8 h-8)
                       [&::-webkit-slider-thumb]:w-8 [&::-webkit-slider-thumb]:h-8 [&::-webkit-slider-thumb]:bg-lime-400 
                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(163,230,53,0.8)]
                       [&::-moz-range-thumb]:w-8 [&::-moz-range-thumb]:h-8 [&::-moz-range-thumb]:bg-lime-400 
                       [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0"
        />

        {/* Value Display - Larger and brighter for visual feedback */}
        <div className="text-sm font-mono text-lime-400 border border-lime-400/50 px-2 py-0.5 rounded absolute top-12 sm:top-14"> 
                {(value * 100).toFixed(0)}
        </div>
      </div>
    );
  };

  return (
    // Set body to pure black for max contrast
    <div className="min-h-screen w-full bg-black flex items-center justify-center p-4 font-sans select-none">
      
      {/* DEVICE CASE - Dark background with white, high-contrast border */}
      <div className="relative w-full md:max-w-3xl lg:max-w-4xl max-h-[95vh] bg-zinc-900 rounded-xl shadow-2xl border-4 border-white overflow-y-auto flex flex-col">
        
        {/* --- TOP LCD SCREEN - High Contrast --- */}
        <div className="mt-8 mx-6 mb-4 p-4 bg-zinc-950 shadow-inner border-4 border-lime-400/50 rounded-sm relative overflow-hidden shrink-0 h-28">
            <div className="absolute inset-0 opacity-10 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/pixel-weave.png')]"></div>
            
            {/* LCD Content - Bright text on dark background */}
            <div className="relative z-10 flex flex-col h-full justify-between font-mono text-lime-400">
                
                <div className="flex justify-center items-center border-b-2 border-lime-400/20 pb-1 shrink-0">
                    <span className="text-xs uppercase font-bold tracking-widest mr-4">SYNTH MODE</span>
                    <div className="flex flex-col items-center">
                         <span className="text-xs uppercase font-bold tracking-widest">SLOT</span>
                         <div className="flex items-center gap-1">
                            <span className="text-3xl font-bold leading-none font-digital">{selectedSlot + 1}</span>
                            <span className="text-sm">{sounds[selectedSlot].name}</span>
                         </div>
                    </div>
                </div>

                {/* Visualizer / Animation - Bright color bars */}
                <div className="flex-1 flex items-end justify-between gap-0.5 pt-2">
                    {Array.from(visualData).map((val, i) => (
                        <div key={i} className="flex-1 bg-fuchsia-400" style={{ height: `${Math.max(5, val)}%` }}></div>
                    ))}
                </div>

                {/* Type Indicators */}
                <div className="flex justify-between text-[10px] font-bold pt-1 shrink-0">
                    <span className={sounds[selectedSlot].type === 'blip' ? "opacity-100" : "opacity-40"}>BLIP</span>
                    <span className={sounds[selectedSlot].type === 'noise' ? "opacity-100" : "opacity-40"}>NOISE</span>
                    <span className="opacity-40">FX</span>
                    <span className="opacity-40">VOL</span>
                    <span className="opacity-40">FREE</span>
                </div>
            </div>
        </div>

        {/* --- CONTROLS AREA --- */}
        <div className="px-6 pb-8 flex flex-col flex-grow">
            
            {/* 1. SLIDER PARAMETERS (4 ROWS) */}
            <div className="flex flex-col gap-10 mb-6 pt-4 px-2 shrink-0">
                <RangeInput 
                    label="PITCH" 
                    value={sounds[selectedSlot].pitch} 
                    onChange={(v) => updateParam('pitch', v)} 
                    colorClass="text-red-500"
                />
                <RangeInput 
                    label="DECAY" 
                    value={sounds[selectedSlot].decay} 
                    onChange={(v) => updateParam('decay', v)} 
                    colorClass="text-yellow-400"
                />
                 <RangeInput 
                    label="COLOR (Filter)" 
                    value={sounds[selectedSlot].color} 
                    onChange={(v) => updateParam('color', v)} 
                    colorClass="text-cyan-400"
                />
                 <RangeInput 
                    label="CRUSH (Distortion)" 
                    value={sounds[selectedSlot].crush} 
                    onChange={(v) => updateParam('crush', v)} 
                    colorClass="text-fuchsia-400"
                />
            </div>

            {/* 2. SOUND SELECT PADS (4x2) */}
            <div className="mt-auto mb-8 shrink-0">
                <div className="flex justify-between items-center mb-4 px-1">
                    <span className="text-sm uppercase text-white font-bold">SOUND BANK</span>
                </div>
                <div className="grid grid-cols-4 gap-4">
                    {sounds.map((sound, i) => (
                        <button
                            key={i}
                            onClick={() => {
                                setSelectedSlot(i);
                                playSound(i);
                            }}
                            className={`
                                // Larger button target size
                                aspect-square rounded-xl flex items-center justify-center border-4 transition-all active:scale-95
                                ${selectedSlot === i 
                                    // Active state: Bright Fuchsia background, White Border, Neon Shadow
                                    ? 'bg-fuchsia-600 border-white shadow-[0_0_20px_rgba(232,84,204,0.8)]' 
                                    // Inactive state: Very Dark background, White text, Bright Border
                                    : 'bg-zinc-800 border-lime-400/50 hover:bg-zinc-700'
                                }
                            `}
                        >
                            {/* Large, High-Contrast Text */}
                            <span className="text-2xl sm:text-3xl font-black text-white">{i+1}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* MASTER VOLUME */}
            <div className="flex flex-col items-center pt-2 shrink-0">
                <span className="text-sm uppercase text-white font-bold mb-2">MASTER VOL</span>
                <input 
                    type="range"
                    min="0"
                    max="1"
                    step="0.001" // Changed to 0.001 for 1000 steps (more gradual control)
                    value={masterVolume}
                    onChange={(e) => {
                        const newVolume = parseFloat(e.target.value);
                        setMasterVolume(newVolume); // 1. Update master volume state
                        throttledPlaySound(); // 2. Play the sound with new volume
                    }}
                    className="w-full h-4 bg-zinc-800 rounded-lg appearance-none cursor-pointer range-lg 
                               // Master Volume thumb size also increased to w-8 h-8
                               [&::-webkit-slider-thumb]:w-8 [&::-webkit-slider-thumb]:h-8 [&::-webkit-slider-thumb]:bg-lime-400 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full"
                />
            </div>

        </div>
      </div>
    </div>
  );
}