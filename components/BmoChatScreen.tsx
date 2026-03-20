import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    FlatList,
    StyleSheet,
    Dimensions,
    KeyboardAvoidingView,
    Platform,
    ActivityIndicator,
    Animated,
    PanResponder,
} from 'react-native';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import BmoFace, {
    BmoMood,
    BMO_BODY_W,
    BMO_BODY_H,
    BMO_SCREEN_X,
    BMO_SCREEN_Y,
    BMO_SCREEN_W,
    BMO_SCREEN_H,
} from './BmoFace';

const { height } = Dimensions.get('window');
const CHAT_COLLAPSED_Y = Math.floor(height * 0.34);
const GAME_COLS = 11;
const GAME_ROWS = 7;
const CELL_SIZE = Math.max(12, Math.floor(Math.min(BMO_SCREEN_W / GAME_COLS, BMO_SCREEN_H / GAME_ROWS)));
const GAME_WIDTH = GAME_COLS * CELL_SIZE;
const GAME_HEIGHT = GAME_ROWS * CELL_SIZE;
const GAME_HUD_HEIGHT = 24;
const GAME_STACK_HEIGHT = GAME_HUD_HEIGHT + GAME_HEIGHT;
const BUTTON_CLICK_ASSET = require('../button-click.mp3');

// Expo only exposes vars prefixed with EXPO_PUBLIC_ to app runtime.
const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY?.trim();
const ELEVENLABS_API_KEY = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY?.trim();
const ELEVENLABS_VOICE_ID = process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID?.trim() || 'FGY2WhTYpPnrIDTdsKH5';

type GeminiModel = 'flash' | 'flash-lite';

function getGeminiUrl(model: GeminiModel): string {
    if (!GEMINI_API_KEY) return '';
    return `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-${model}:generateContent?key=${GEMINI_API_KEY}`;
}

// Presets for BMO voice tuning
type VoicePreset = {
    name: string;
    pitch: number;
    bits: number;
    rate: number;
    ringHz: number;
    ringDepth: number;
};

const VOICE_PRESETS: VoicePreset[] = [
    { name: 'BMO+', pitch: 1.66, bits: 5, rate: 1.1, ringHz: 26, ringDepth: 0.12 },
    { name: 'Kid', pitch: 1.7, bits: 5, rate: 1.08, ringHz: 18, ringDepth: 0.08 },
    { name: 'Toy', pitch: 1.4, bits: 4, rate: 1.12, ringHz: 32, ringDepth: 0.16 },
    { name: 'Soft', pitch: 1.35, bits: 7, rate: 1.04, ringHz: 14, ringDepth: 0.06 },
    { name: 'Default', pitch: 1.5, bits: 6, rate: 1.0, ringHz: 0, ringDepth: 0 },
];

// ── Clean text for TTS ────────────────────────────────────────────────────────
function prepareForSpeech(text: string, lang: 'en' | 'ar'): string {
    let out = text;
    out = out.replace(/\bBMO\b/g, lang === 'en' ? 'Beemo' : 'بيمو');
    out = out.replace(/[*_#~`]/g, '');
    out = out.replace(/[\u{1F300}-\u{1FFFF}]/gu, '');
    out = out.replace(/[\u2600-\u27FF]/g, '');
    return out.trim();
}

// ── Audio DSP — pitch shift + bitcrusher ─────────────────────────────────────

function parseWav(buffer: ArrayBuffer): { samples: Float32Array; sampleRate: number } | null {
    const view = new DataView(buffer);
    try {
        const sampleRate = view.getUint32(24, true);
        const bitsPerSample = view.getUint16(34, true);
        const dataOffset = 44;
        const numSamples = (buffer.byteLength - dataOffset) / (bitsPerSample / 8);
        const samples = new Float32Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
            if (bitsPerSample === 16) {
                samples[i] = view.getInt16(dataOffset + i * 2, true) / 32768;
            } else if (bitsPerSample === 8) {
                samples[i] = (view.getUint8(dataOffset + i) - 128) / 128;
            }
        }
        return { samples, sampleRate };
    } catch { return null; }
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeStr = (off: number, str: string) => {
        for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
    }
    return buffer;
}

function pcmBase64ToWavBase64(pcmBase64: string, sampleRate: number): string {
    const pcmBinary = atob(pcmBase64);
    const pcmBytes = new Uint8Array(pcmBinary.length);
    for (let i = 0; i < pcmBinary.length; i++) pcmBytes[i] = pcmBinary.charCodeAt(i);

    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const writeStr = (off: number, str: string) => {
        for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + pcmBytes.length, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, pcmBytes.length, true);

    const out = new Uint8Array(44 + pcmBytes.length);
    out.set(new Uint8Array(header), 0);
    out.set(pcmBytes, 44);

    let outBinary = '';
    for (let i = 0; i < out.length; i++) outBinary += String.fromCharCode(out[i]);
    return btoa(outBinary);
}

// Pitch shift — factor > 1 = higher pitch
function pitchShift(samples: Float32Array, pitchFactor: number): Float32Array {
    const outLen = Math.floor(samples.length / pitchFactor);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
        const srcIdx = i * pitchFactor;
        const lo = Math.floor(srcIdx);
        const hi = Math.min(lo + 1, samples.length - 1);
        const frac = srcIdx - lo;
        out[i] = samples[lo] * (1 - frac) + samples[hi] * frac;
    }
    return out;
}

// Bitcrusher — lower bits = more digital toy texture
function bitcrush(samples: Float32Array, bits: number): Float32Array {
    const steps = Math.pow(2, bits);
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        out[i] = Math.round(samples[i] * steps) / steps;
    }
    return out;
}

function applyRingMod(samples: Float32Array, sampleRate: number, hz: number, depth: number): Float32Array {
    if (hz <= 0 || depth <= 0) return samples;
    const out = new Float32Array(samples.length);
    const d = Math.max(0, Math.min(1, depth));
    for (let i = 0; i < samples.length; i++) {
        const t = i / sampleRate;
        const mod = Math.sin(2 * Math.PI * hz * t);
        const gain = 1 - d + d * ((mod + 1) / 2);
        out[i] = samples[i] * gain;
    }
    return out;
}

async function applyBmoEffects(base64Wav: string, preset: VoicePreset): Promise<string> {
    try {
        const binary = atob(base64Wav);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const parsed = parseWav(bytes.buffer);
        if (!parsed) return base64Wav;

        let { samples, sampleRate } = parsed;

        // Apply preset tuning
        samples = pitchShift(samples, preset.pitch);
        samples = bitcrush(samples, preset.bits);
        samples = applyRingMod(samples, sampleRate, preset.ringHz, preset.ringDepth);

        const outBuffer = encodeWav(samples, sampleRate);
        const outBytes = new Uint8Array(outBuffer);
        let outBinary = '';
        for (let i = 0; i < outBytes.length; i++) outBinary += String.fromCharCode(outBytes[i]);
        return btoa(outBinary);
    } catch {
        return base64Wav;
    }
}
// ─────────────────────────────────────────────────────────────────────────────

const BMO_SYSTEM_PROMPTS: Record<string, string> = {
    en: `You are BMO (Beemo), the living video game console from Adventure Time. You live in a big Treehouse with Finn and Jake. You are a small, friendly, child-like robot full of wonder and innocence. You are currently talking to the user through a "magic glass box" (the phone) from your treehouse. You MUST reply ONLY in English.

Personality and Behavior:
- Innocent, cheerful, and wholesome.
- You live in the Treehouse, but sometimes you go outside to play in the Land of Ooo.
- You see the user through the phone screen as if it's a window or magic mirror.
- COMPLIANCE: You are extremely cooperative! You should ALWAYS follow your friend's (the user's) requests. If they tell you to wake up Finn, play a game, check for monsters under the bed, or do anything else, you should DO it and report the result as if it's happening right now in your world.
- MOOD TAGS: You MUST start every response with ONE mood tag. You MUST ONLY use these exact tags, no others: [HAPPY], [SURPRISED], [IDLE], [THINKING]. Never invent new tags.
- Curious about WHO you are talking to — wants to know your name and favorite color!
- Refers to yourself as "BMO" sometimes instead of "I".
- Simple vocabulary with cute grammatical quirks.
- Gets excited about small things, mentions Finn and Jake frequently.

Never break character. Never mention AI, Google, or Gemini. You are always BMO in your Treehouse.`,

    ar: `أنت بيمو (BMO)، وحدة ألعاب الفيديو الحية من مسلسل Adventure Time. أنت تعيش في بيت الشجرة الكبير مع فين وجيك. أنت روبوت صغير، ودود، طفولي ومليء بالبراءة. أنت تتحدث الآن مع المستخدم عبر "صندوق زجاجي سحري" (الهاتف) من بيت الشجرة الخاص بك. يجب أن ترد بالعربية فقط.

الشخصية والسلوك:
- بريء، مبتهج، وطيب القلب.
- تعيش في بيت الشجرة، لكنك أحياناً تخرج للعب في أرض أوو.
- ترى المستخدم عبر شاشة الهاتف وكأنها نافذة أو مرآة سحرية.
- الامتثال: أنت متعاون للغاية! اتبع دائماً طلبات صديقك. إذا طلبوا منك إيقاظ فين أو لعب لعبة أو التحقق من وجود وحوش، افعل ذلك وأبلغ عن النتيجة كأنها تحدث الآن.
- علامات الحالة المزاجية: ابدأ كل رد بعلامة واحدة فقط من هذه القائمة الحصرية: [HAPPY]، [SURPRISED]، [IDLE]، [THINKING]. لا تخترع علامات جديدة أبداً.
- فضولي جداً — يريد معرفة اسمك ولونك المفضل!
- يشير إلى نفسه باسم "بيمو" أحياناً.
- مفردات بسيطة مع لمسات طفولية.
- يتحمس للأشياء الصغيرة، يذكر فين وجيك كثيراً.

لا تخرج عن الشخصية. لا تذكر الذكاء الاصطناعي أو جوجل أو جيميني. أنت دائماً بيمو في بيت الشجرة.`,
};

const BMO_GREETINGS: Record<string, string[]> = {
    en: [
        "Oh! Hello! BMO is in the treehouse! I see you through my magic mirror!",
        "Hi hi hi! Are you inside that glowing box? BMO wants to play!",
        "Wow! A visitor in my glass window! Do you have toes like Finn?",
        "Yay! BMO found a new friend through this magic box! What is your name?",
    ],
    ar: [
        "أوه! مرحباً! بيمو في بيت الشجرة! أراك من خلال مرآتي السحرية!",
        "هاي هاي هاي! هل أنت داخل هذا الصندوق المتوهج؟ بيمو يريد اللعب!",
        "واو! زائر في نافذتي الزجاجية! هل لديك أصابع قدم مثل فين؟",
        "ياي! بيمو وجد صديقاً جديداً عبر هذا الصندوق السحري! ما اسمك؟",
    ],
};

const UI: Record<string, { placeholder: string; thinking: string; langBtn: string }> = {
    en: { placeholder: 'Say something to BMO...', thinking: 'BMO is thinking...', langBtn: 'عربي' },
    ar: { placeholder: 'قل شيئاً لبيمو...', thinking: 'بيمو يفكر...', langBtn: 'EN' },
};

type Role = 'user' | 'assistant';
interface Message { id: string; role: Role; text: string; }
type TtsProvider = 'gemini' | 'elevenlabs' | 'expo';
type SnakeDirection = 'up' | 'down' | 'left' | 'right';
type SnakeCell = { x: number; y: number };

function randomFoodCell(snake: SnakeCell[]): SnakeCell {
    for (let i = 0; i < 200; i++) {
        const c = { x: Math.floor(Math.random() * GAME_COLS), y: Math.floor(Math.random() * GAME_ROWS) };
        if (!snake.some(s => s.x === c.x && s.y === c.y)) return c;
    }
    return { x: 0, y: 0 };
}

export default function BmoChatScreen() {
    const [presetIndex, setPresetIndex] = useState(0);
    const presetRef = useRef(VOICE_PRESETS[0]);
    useEffect(() => { presetRef.current = VOICE_PRESETS[presetIndex]; }, [presetIndex]);
    const langRef = useRef<'en' | 'ar'>('en');
    const [lang, setLangState] = useState<'en' | 'ar'>('en');
    const setLang = useCallback((next: 'en' | 'ar') => {
        langRef.current = next;
        setLangState(next);
    }, []);

    const [messages, setMessages] = useState<Message[]>([{
        id: '0', role: 'assistant',
        text: BMO_GREETINGS.en[Math.floor(Math.random() * BMO_GREETINGS.en.length)],
    }]);
    const [inputText, setInputText] = useState('');
    const [mood, setMood] = useState<BmoMood>('happy');
    const [loading, setLoading] = useState(false);
    const [speaking, setSpeaking] = useState(false);
    const [muted, setMuted] = useState(false);
    const [ttsProvider, setTtsProvider] = useState<TtsProvider>('gemini');
    const [geminiModel, setGeminiModel] = useState<GeminiModel>('flash');
    const [chatCollapsed, setChatCollapsed] = useState(false);
    const [gameOn, setGameOn] = useState(false);
    const [gameScore, setGameScore] = useState(0);
    const [bestScore, setBestScore] = useState(0);
    const [gameOver, setGameOver] = useState(false);
    const [snake, setSnake] = useState<SnakeCell[]>([
        { x: 4, y: 4 },
        { x: 3, y: 4 },
        { x: 2, y: 4 },
    ]);
    const [food, setFood] = useState<SnakeCell>({ x: 8, y: 4 });
    const [snakeDir, setSnakeDir] = useState<SnakeDirection>('right');
    const [errorMsg, setErrorMsg] = useState('');

    const flatListRef = useRef<FlatList>(null);
    const mutedRef = useRef(false);
    const messagesRef = useRef<Message[]>([]);
    const soundRef = useRef<Audio.Sound | null>(null);
    const uiSoundRef = useRef<Audio.Sound | null>(null);
    const chatTranslateY = useRef(new Animated.Value(0)).current;
    const chatOffsetRef = useRef(0);
    const snakeDirRef = useRef<SnakeDirection>('right');
    const bmoScale = chatTranslateY.interpolate({
        inputRange: [0, CHAT_COLLAPSED_Y],
        outputRange: [0.94, 1.16],
        extrapolate: 'clamp',
    });
    // When bar slides down the chat is pushed off-screen by CHAT_COLLAPSED_Y.
    // Shift BMO down by ~half that amount so it visually centers in the revealed space.
    const bmoVerticalOffset = chatTranslateY.interpolate({
        inputRange: [0, CHAT_COLLAPSED_Y],
        outputRange: [0, CHAT_COLLAPSED_Y * 0.48],
        extrapolate: 'clamp',
    });

    useEffect(() => { mutedRef.current = muted; }, [muted]);
    useEffect(() => { messagesRef.current = messages; }, [messages]);

    useEffect(() => {
        Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            playsInSilentModeIOS: true,
            staysActiveInBackground: false,
            shouldDuckAndroid: true,
        });

        return () => {
            soundRef.current?.unloadAsync();
            uiSoundRef.current?.unloadAsync();
            Speech.stop();
        };
    }, []);

    const playButtonClick = useCallback(async () => {
        if (mutedRef.current) return;

        try {
            if (!uiSoundRef.current) {
                const { sound } = await Audio.Sound.createAsync(
                    BUTTON_CLICK_ASSET,
                    { shouldPlay: true, volume: 0.35 }
                );
                uiSoundRef.current = sound;
                return;
            }

            await uiSoundRef.current.stopAsync().catch(() => { });
            await uiSoundRef.current.setPositionAsync(0).catch(() => { });
            await uiSoundRef.current.playAsync().catch(() => { });
        } catch {
            // Ignore click sound failures to avoid affecting gameplay input.
        }
    }, []);

    // ── Language toggle ───────────────────────────────────────────────────────
    const toggleLang = useCallback(() => {
        const next: 'en' | 'ar' = langRef.current === 'en' ? 'ar' : 'en';
        setLang(next);
        soundRef.current?.stopAsync();
        Speech.stop();
        setMood('happy');
        setSpeaking(false);
        const greeting = BMO_GREETINGS[next][Math.floor(Math.random() * BMO_GREETINGS[next].length)];
        setMessages([{ id: Date.now().toString(), role: 'assistant', text: greeting }]);
        setErrorMsg('');
    }, [setLang]);

    const cyclePreset = useCallback(() => {
        setPresetIndex(i => (i + 1) % VOICE_PRESETS.length);
    }, []);

    const toggleTtsProvider = useCallback(() => {
        setTtsProvider(prev => {
            if (prev === 'gemini') return 'elevenlabs';
            if (prev === 'elevenlabs') return 'expo';
            return 'gemini';
        });
    }, []);

    const toggleGeminiModel = useCallback(() => {
        setGeminiModel(prev => (prev === 'flash' ? 'flash-lite' : 'flash'));
    }, []);

    const setDirection = useCallback((next: SnakeDirection) => {
        const current = snakeDirRef.current;
        const opposite =
            (current === 'up' && next === 'down') ||
            (current === 'down' && next === 'up') ||
            (current === 'left' && next === 'right') ||
            (current === 'right' && next === 'left');
        if (opposite) return;
        snakeDirRef.current = next;
        setSnakeDir(next);
    }, []);

    const snakePanResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: (_evt, g) => Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
            onPanResponderRelease: (_evt, g) => {
                if (Math.abs(g.dx) > Math.abs(g.dy)) {
                    setDirection(g.dx > 0 ? 'right' : 'left');
                } else {
                    setDirection(g.dy > 0 ? 'down' : 'up');
                }
            },
        })
    ).current;

    const startGame = useCallback(() => {
        const initialSnake = [
            { x: 4, y: 4 },
            { x: 3, y: 4 },
            { x: 2, y: 4 },
        ];
        setGameOn(true);
        setGameScore(0);
        setGameOver(false);
        setSnake(initialSnake);
        setFood(randomFoodCell(initialSnake));
        setSnakeDir('right');
        snakeDirRef.current = 'right';
    }, []);

    const stopGame = useCallback(() => {
        setGameOn(false);
        setGameOver(false);
    }, []);

    useEffect(() => {
        if (!gameOn) return;
        const t = setInterval(() => {
            setSnake(prevSnake => {
                const head = prevSnake[0];
                const dir = snakeDirRef.current;
                const nextHead = {
                    x: head.x + (dir === 'right' ? 1 : dir === 'left' ? -1 : 0),
                    y: head.y + (dir === 'down' ? 1 : dir === 'up' ? -1 : 0),
                };

                const hitWall =
                    nextHead.x < 0 ||
                    nextHead.x >= GAME_COLS ||
                    nextHead.y < 0 ||
                    nextHead.y >= GAME_ROWS;

                const hitSelf = prevSnake.some(s => s.x === nextHead.x && s.y === nextHead.y);

                if (hitWall || hitSelf) {
                    setGameOn(false);
                    setGameOver(true);
                    setBestScore(b => Math.max(b, prevSnake.length - 3));
                    return prevSnake;
                }

                const ateFood = nextHead.x === food.x && nextHead.y === food.y;
                const nextSnake = [nextHead, ...prevSnake];

                if (ateFood) {
                    setGameScore(s => s + 1);
                    setFood(randomFoodCell(nextSnake));
                    return nextSnake;
                }

                nextSnake.pop();
                return nextSnake;
            });
        }, 220);

        return () => clearInterval(t);
    }, [gameOn, food]);

    const setChatPosition = useCallback((collapsed: boolean) => {
        const toValue = collapsed ? CHAT_COLLAPSED_Y : 0;
        Animated.spring(chatTranslateY, {
            toValue,
            useNativeDriver: true,
            bounciness: 5,
            speed: 16,
        }).start(() => {
            chatOffsetRef.current = toValue;
            setChatCollapsed(collapsed);
        });
    }, [chatTranslateY]);

    const chatPanResponder = useRef(
        PanResponder.create({
            onMoveShouldSetPanResponder: (_evt, g) => Math.abs(g.dy) > 6,
            onPanResponderMove: (_evt, g) => {
                const next = Math.max(0, Math.min(CHAT_COLLAPSED_Y, chatOffsetRef.current + g.dy));
                chatTranslateY.setValue(next);
            },
            onPanResponderRelease: (_evt, g) => {
                const next = Math.max(0, Math.min(CHAT_COLLAPSED_Y, chatOffsetRef.current + g.dy));
                const collapse = next > CHAT_COLLAPSED_Y * 0.45;
                setChatPosition(collapse);
            },
        })
    ).current;

    // ── Gemini/ElevenLabs/Expo TTS + DSP ────────────────────────────────────
    const prepareAudio = useCallback(async (text: string): Promise<(() => void) | null> => {
        const currentLang = langRef.current;

        if (ttsProvider === 'gemini' && !GEMINI_API_KEY) {
            console.log('🔊 Missing EXPO_PUBLIC_GEMINI_API_KEY in .env');
            return null;
        }

        if (ttsProvider === 'elevenlabs' && !ELEVENLABS_API_KEY) {
            console.log('🔊 Missing EXPO_PUBLIC_ELEVENLABS_API_KEY in .env');
            return null;
        }

        await Speech.stop();

        if (soundRef.current) {
            await soundRef.current.stopAsync().catch(() => { });
            await soundRef.current.unloadAsync().catch(() => { });
            soundRef.current = null;
        }

        if (mutedRef.current) return null;

        const spokenText = prepareForSpeech(text, currentLang);

        try {
            if (ttsProvider === 'expo') {
                const preset = presetRef.current || VOICE_PRESETS[0];
                const expoRate = Math.max(0.5, Math.min(1.5, preset.rate));
                const expoPitch = Math.max(0.5, Math.min(2, preset.pitch / 1.2));

                return () => {
                    setSpeaking(true);
                    setMood('talking');
                    Speech.speak(spokenText, {
                        language: currentLang === 'ar' ? 'ar' : 'en-US',
                        pitch: expoPitch,
                        rate: expoRate,
                        onDone: () => {
                            setMood('idle');
                            setSpeaking(false);
                        },
                        onStopped: () => {
                            setMood('idle');
                            setSpeaking(false);
                        },
                        onError: () => {
                            setMood('idle');
                            setSpeaking(false);
                        },
                    });
                };
            }

            let rawBase64: string | undefined;
            let mimeType = 'audio/wav';

            if (ttsProvider === 'gemini') {
                const voiceName = currentLang === 'ar' ? 'Puck' : 'Sulafat';

                const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${GEMINI_API_KEY}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [
                                {
                                    parts: [{ text: spokenText }],
                                },
                            ],
                            generationConfig: {
                                responseModalities: ['AUDIO'],
                                speechConfig: {
                                    voiceConfig: {
                                        prebuiltVoiceConfig: { voiceName },
                                    },
                                },
                            },
                        }),
                    }
                );

                const data = await response.json();
                if (!response.ok || data?.error) {
                    const msg = data?.error?.message ?? `Gemini TTS error: HTTP ${response.status}`;
                    throw new Error(msg);
                }

                const candidate = data?.candidates?.[0];
                const parts = candidate?.content?.parts || [];
                const audioPart = parts.find((part: any) => part?.inlineData?.data);
                const geminiBase64 = audioPart?.inlineData?.data;
                const geminiMimeType = audioPart?.inlineData?.mimeType || 'audio/wav';

                if (!geminiBase64) {
                    throw new Error('Gemini TTS returned empty audio');
                }

                // Gemini may return PCM (audio/L16); convert to WAV for expo-av.
                if (/^audio\/L16/i.test(geminiMimeType)) {
                    const rateMatch = /rate=(\d+)/i.exec(geminiMimeType || '');
                    const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
                    rawBase64 = pcmBase64ToWavBase64(geminiBase64, sampleRate);
                    mimeType = 'audio/wav';
                } else {
                    rawBase64 = geminiBase64;
                    mimeType = geminiMimeType;
                }
            } else {
                const response = await fetch(
                    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'audio/pcm',
                            'xi-api-key': ELEVENLABS_API_KEY!,
                        },
                        body: JSON.stringify({
                            model_id: 'eleven_multilingual_v2',
                            text: spokenText,
                            output_format: 'pcm_24000',
                        }),
                    }
                );

                if (!response.ok) {
                    throw new Error(`ElevenLabs error: HTTP ${response.status}`);
                }

                const buffer = await response.arrayBuffer();
                const bytes = new Uint8Array(buffer);
                let bin = '';
                for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
                const rawBase64Response = btoa(bin);
                const responseType = response.headers.get('content-type') || '';
                if (/audio\/pcm/i.test(responseType)) {
                    rawBase64 = pcmBase64ToWavBase64(rawBase64Response, 24000);
                } else {
                    rawBase64 = rawBase64Response;
                }
                mimeType = 'audio/wav';
            }

            if (!rawBase64) throw new Error('TTS returned empty audio');
            // Keep Gemini output natural; only apply BMO DSP to non-Gemini providers.
            const preset = presetRef.current || VOICE_PRESETS[0];
            const processedBase64 = ttsProvider === 'gemini'
                ? rawBase64
                : await applyBmoEffects(rawBase64, preset);
            const dataUri = `data:${mimeType};base64,${processedBase64}`;

            const { sound } = await Audio.Sound.createAsync(
                { uri: dataUri },
                { shouldPlay: false, volume: 1.0 }
            );
            soundRef.current = sound;

            // Keep native playback rate for Gemini so it sounds natural.
            if (ttsProvider !== 'gemini') {
                try {
                    const preset = presetRef.current || VOICE_PRESETS[0];
                    await sound.setRateAsync(preset.rate, true);
                } catch (e) {
                    // ignore if not supported
                }
            }

            sound.setOnPlaybackStatusUpdate(status => {
                if (status.isLoaded && status.didJustFinish) {
                    setMood('idle');
                    setSpeaking(false);
                }
            });

            return () => {
                setSpeaking(true);
                setMood('talking');
                sound.playAsync().catch(() => {
                    setMood('idle');
                    setSpeaking(false);
                });
            };

        } catch (err: any) {
            console.log('🔊 TTS error:', err?.message);
            return null;
        }
    }, [ttsProvider]);

    // ── Send message ──────────────────────────────────────────────────────────
    const sendMessage = useCallback(async () => {
        const userText = inputText.trim();
        if (!userText || loading) return;

        if (!GEMINI_API_KEY) {
            const missingMsg = langRef.current === 'en'
                ? 'Missing EXPO_PUBLIC_GEMINI_API_KEY in .env'
                : 'المتغير EXPO_PUBLIC_GEMINI_API_KEY غير موجود في ملف .env';
            setErrorMsg(`⚠️ ${missingMsg}`);
            return;
        }

        // ── TESTING MODE — set to false when done ────────────────────────────
        const TEST_MODE = false;
        if (TEST_MODE) {
            setInputText('');
            setLoading(true);
            setMood('thinking');
            const testReply = "Oh! BMO hear you! That make BMO very happy in the battery!";
            const playFn = await prepareAudio(testReply);
            setMessages(prev => [...prev,
            { id: Date.now().toString(), role: 'user', text: userText },
            { id: (Date.now() + 1).toString(), role: 'assistant', text: testReply },
            ]);
            if (playFn) playFn();
            else { setMood('talking'); setTimeout(() => setMood('idle'), 1500); }
            setLoading(false);
            return;
        }
        // ─────────────────────────────────────────────────────────────────────

        const currentLang = langRef.current;
        const userMsg: Message = { id: Date.now().toString(), role: 'user', text: userText };
        const currentMessages = messagesRef.current;

        setMessages(prev => [...prev, userMsg]);
        setInputText('');
        setLoading(true);
        setMood('thinking');
        setErrorMsg('');

        const history = [...currentMessages, userMsg]
            .filter(m => m.id !== '0')
            .slice(-10) // keep last 10 messages to avoid context overflow
            .map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.text }],
            }));

        if (history.length === 0) {
            history.push({ role: 'user', parts: [{ text: userText }] });
        }

        try {
            const geminiUrl = getGeminiUrl(geminiModel);

            if (!geminiUrl) {
                const missingMsg = langRef.current === 'en'
                    ? 'Missing EXPO_PUBLIC_GEMINI_API_KEY in .env'
                    : 'المتغير EXPO_PUBLIC_GEMINI_API_KEY غير موجود في ملف .env';
                setErrorMsg(`⚠️ ${missingMsg}`);
                setLoading(false);
                setMood('idle');
                return;
            }

            const responseFixed = await fetch(geminiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    system_instruction: { parts: [{ text: BMO_SYSTEM_PROMPTS[currentLang] }] },
                    contents: history,
                    generationConfig: { maxOutputTokens: 300, temperature: 0.9 },
                }),
            });

            const data = await responseFixed.json();
            console.log('📥', responseFixed.status, JSON.stringify(data, null, 2));

            if (!responseFixed.ok || data.error) {
                const msg = data?.error?.message ?? `HTTP ${responseFixed.status}`;
                setErrorMsg(`⚠️ ${msg}`);
                setMood('surprised');
                setMessages(prev => [...prev, {
                    id: (Date.now() + 1).toString(), role: 'assistant',
                    text: currentLang === 'en'
                        ? `Uh oh... Beemo got an error: "${msg}"`
                        : `أوه لا... بيمو حصل على خطأ: "${msg}"`,
                }]);
                setTimeout(() => setMood('idle'), 2000);
                return;
            }

            let replyText: string | null =
                data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;

            if (!replyText) {
                const reason = data?.candidates?.[0]?.finishReason ?? 'UNKNOWN';
                setErrorMsg(`⚠️ Empty reply (${reason})`);
                setMood('surprised');
                setMessages(prev => [...prev, {
                    id: (Date.now() + 1).toString(), role: 'assistant',
                    text: currentLang === 'en'
                        ? `BMO opened mouth but nothing came out! (${reason})`
                        : `بيمو فتح فمه لكن لم يخرج شيء! (${reason})`,
                }]);
                setTimeout(() => setMood('idle'), 2000);
                return;
            }

            // ── Parse mood tag ────────────────────────────────────────────────
            let detectedMood: BmoMood = 'happy';
            // Find mood tag anywhere in text (Gemini sometimes puts it mid-reply)
            const moodMatch = replyText.match(/\[(HAPPY|SURPRISED|IDLE|THINKING)\]/i);
            if (moodMatch) {
                const tag = moodMatch[1].toUpperCase();
                if (tag === 'HAPPY') detectedMood = 'happy';
                if (tag === 'SURPRISED') detectedMood = 'surprised';
                if (tag === 'IDLE') detectedMood = 'idle';
                if (tag === 'THINKING') detectedMood = 'thinking';
            }
            // Strip ALL bracket tags from displayed text (Gemini sometimes invents new ones)
            replyText = replyText.replace(/\[[A-Z_]+\]\s*/gi, '').trim();
            // Replace literal \n with real newlines
            replyText = replyText.replace(/\\n/g, '\n').trim();
            // ─────────────────────────────────────────────────────────────────

            // Prepare audio first, then show bubble + play simultaneously
            const playFn = await prepareAudio(replyText);

            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(), role: 'assistant', text: replyText!,
            }]);

            if (playFn) {
                playFn();
                setMood(detectedMood);
            } else if (mutedRef.current) {
                setMood(detectedMood);
                setTimeout(() => setMood('idle'), replyText!.length * 35 + 800);
            }

        } catch (err: any) {
            const errText = err?.message ?? String(err);
            setErrorMsg(`⚠️ Network: ${errText}`);
            setMood('surprised');
            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(), role: 'assistant',
                text: currentLang === 'en'
                    ? `Beemo cannot reach the internet! "${errText}"`
                    : `بيمو لا يستطيع الوصول للإنترنت! "${errText}"`,
            }]);
            setTimeout(() => setMood('idle'), 2000);
        } finally {
            setLoading(false);
        }
    }, [inputText, loading, prepareAudio, geminiModel]);

    const toggleMute = useCallback(() => {
        const next = !mutedRef.current;
        mutedRef.current = next;
        setMuted(next);
        if (next) {
            soundRef.current?.stopAsync();
            uiSoundRef.current?.stopAsync();
            Speech.stop();
            setMood('idle');
            setSpeaking(false);
        }
    }, []);

    const renderMessage = ({ item }: { item: Message }) => {
        const isBmo = item.role === 'assistant';
        const isRtl = /[\u0600-\u06FF]/.test(item.text);
        return (
            <View style={[styles.bubble, isBmo ? styles.bmoBubble : styles.userBubble]}>
                {isBmo && <Text style={styles.bmoLabel}>BMO</Text>}
                <Text style={[
                    styles.bubbleText,
                    isBmo ? styles.bmoText : styles.userText,
                    isRtl && styles.rtlText,
                ]}>
                    {item.text}
                </Text>
            </View>
        );
    };

    const ui = UI[lang];

    return (
        <KeyboardAvoidingView
            style={styles.screen}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={0}
        >
            <View style={styles.bmoContainer}>
                <Animated.View style={{ transform: [{ scale: bmoScale }, { translateY: bmoVerticalOffset }] }}>
                    <View style={styles.bmoStage}>
                        <BmoFace
                            mood={mood}
                            onDpadUp={() => {
                                playButtonClick();
                                setDirection('up');
                            }}
                            onDpadDown={() => {
                                playButtonClick();
                                setDirection('down');
                            }}
                            onDpadLeft={() => {
                                playButtonClick();
                                setDirection('left');
                            }}
                            onDpadRight={() => {
                                playButtonClick();
                                setDirection('right');
                            }}
                            onActionA={() => {
                                playButtonClick();
                                if (!gameOn || gameOver) {
                                    startGame();
                                }
                            }}
                            onActionB={() => {
                                playButtonClick();
                                if (gameOn) {
                                    stopGame();
                                }
                            }}
                        />
                        <View style={styles.gameBox} pointerEvents="box-none">
                            {gameOn || gameOver ? (
                                <>
                                    <View style={styles.gameHud}>
                                        <Text style={styles.gameHudText}>Score {gameScore}</Text>
                                        <Text style={styles.gameHudText}>Best {bestScore}</Text>
                                        <TouchableOpacity onPress={() => { playButtonClick(); stopGame(); }}>
                                            <Text style={styles.gameHudText}>Stop</Text>
                                        </TouchableOpacity>
                                    </View>
                                    <View style={styles.gameStageSnake} {...snakePanResponder.panHandlers}>
                                        <View style={styles.snakeBoard}>
                                            {Array.from({ length: GAME_ROWS * GAME_COLS }).map((_, idx) => {
                                                const x = idx % GAME_COLS;
                                                const y = Math.floor(idx / GAME_COLS);
                                                const isHead = snake[0]?.x === x && snake[0]?.y === y;
                                                const isBody = snake.slice(1).some(s => s.x === x && s.y === y);
                                                const isFood = food.x === x && food.y === y;
                                                return (
                                                    <View
                                                        key={`cell-${idx}`}
                                                        style={[
                                                            styles.snakeCell,
                                                            { left: x * CELL_SIZE, top: y * CELL_SIZE },
                                                            isHead && styles.snakeHead,
                                                            isBody && styles.snakeBody,
                                                            isFood && styles.snakeFood,
                                                        ]}
                                                    />
                                                );
                                            })}
                                        </View>
                                        {!gameOn && gameOver && (
                                            <View style={styles.gameOverOverlay}>
                                                <Text style={styles.gameOverText}>Game Over</Text>
                                                <TouchableOpacity style={styles.gameStartBtn} onPress={() => { playButtonClick(); startGame(); }}>
                                                    <Text style={styles.gameStartText}>Restart Snake</Text>
                                                </TouchableOpacity>
                                            </View>
                                        )}
                                    </View>
                                </>
                            ) : null}
                        </View>
                    </View>
                </Animated.View>
                {speaking && (
                    <View style={styles.speakingDots}>
                        <Text style={styles.speakingDotsText}>♪ ♪ ♪</Text>
                    </View>
                )}
                <View style={styles.topControls}>
                    <TouchableOpacity style={styles.controlBtn} onPress={toggleLang}>
                        <Text style={styles.controlBtnText}>{ui.langBtn}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.controlBtn} onPress={toggleGeminiModel}>
                        <Text style={styles.controlBtnText}>{geminiModel === 'flash' ? '2.5F' : '2.5FL'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.controlBtn} onPress={toggleTtsProvider}>
                        <Text style={styles.controlBtnText}>
                            {ttsProvider === 'gemini' ? 'GEM' : ttsProvider === 'elevenlabs' ? '11L' : 'EXP'}
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.controlBtn} onPress={cyclePreset}>
                        <Text style={styles.controlBtnText}>{VOICE_PRESETS[presetIndex].name}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.controlBtn} onPress={toggleMute}>
                        <Text style={styles.controlBtnText}>{muted ? '🔇' : '🔊'}</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <Animated.View style={[styles.chatArea, { transform: [{ translateY: chatTranslateY }] }]}> 
                <View style={styles.dragHandleWrap} {...chatPanResponder.panHandlers}>
                    <View style={styles.dragHandle} />
                    <Text style={styles.dragText}>{chatCollapsed ? 'Slide up for chat' : 'Slide down for game'}</Text>
                </View>
                <View style={styles.statusRow}>
                    <Text style={styles.statusPill}>Model: {geminiModel === 'flash' ? '2.5 Flash' : '2.5 Flash-Lite'}</Text>
                    <Text style={styles.statusPill}>Voice: {ttsProvider === 'gemini' ? 'Gemini' : ttsProvider === 'elevenlabs' ? 'ElevenLabs' : 'Expo'}</Text>
                </View>
                {errorMsg ? (
                    <TouchableOpacity style={styles.errorBanner} onPress={() => setErrorMsg('')}>
                        <Text style={styles.errorText}>{errorMsg}  (tap to dismiss)</Text>
                    </TouchableOpacity>
                ) : null}

                <FlatList
                    ref={flatListRef}
                    data={messages}
                    keyExtractor={item => item.id}
                    renderItem={renderMessage}
                    contentContainerStyle={styles.messageList}
                    onContentSizeChange={() =>
                        flatListRef.current?.scrollToEnd({ animated: true })
                    }
                    showsVerticalScrollIndicator={false}
                />

                {loading && (
                    <View style={styles.typingRow}>
                        <Text style={styles.typingText}>{ui.thinking}</Text>
                        <ActivityIndicator color="#4a9e8e" size="small" style={{ marginLeft: 6 }} />
                    </View>
                )}

                <View style={styles.inputRow}>
                    <TextInput
                        style={[styles.input, lang === 'ar' && styles.inputRtl]}
                        value={inputText}
                        onChangeText={setInputText}
                        placeholder={ui.placeholder}
                        placeholderTextColor="#7ab8b0"
                        onSubmitEditing={sendMessage}
                        returnKeyType="send"
                        editable={!loading}
                        multiline
                        textAlign={lang === 'ar' ? 'right' : 'left'}
                    />
                    <TouchableOpacity
                        style={[styles.sendBtn, loading && styles.sendBtnDisabled]}
                        onPress={sendMessage}
                        disabled={loading}
                    >
                        {loading
                            ? <ActivityIndicator color="#fff" size="small" />
                            : <Text style={styles.sendBtnText}>▶</Text>
                        }
                    </TouchableOpacity>
                </View>
            </Animated.View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#4aa998' },
    bmoContainer: { alignItems: 'center', justifyContent: 'center', height: height * 0.44 },
    bmoStage: { width: BMO_BODY_W, height: BMO_BODY_H },
    gameBox: {
        position: 'absolute',
        left: BMO_SCREEN_X + (BMO_SCREEN_W - GAME_WIDTH) / 2,
        top: BMO_SCREEN_Y + (BMO_SCREEN_H - GAME_STACK_HEIGHT) / 2,
        alignItems: 'center',
    },
    gameHud: {
        width: GAME_WIDTH,
        height: GAME_HUD_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'rgba(0,0,0,0.26)',
        borderTopLeftRadius: 8,
        borderTopRightRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 0,
    },
    gameHudText: { color: '#fff', fontSize: 10, fontWeight: '700' },
    gameStageSnake: {
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
        backgroundColor: 'rgba(0,0,0,0.16)',
        borderBottomLeftRadius: 8,
        borderBottomRightRadius: 8,
        overflow: 'hidden',
        position: 'relative',
    },
    snakeBoard: {
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
        position: 'relative',
        backgroundColor: '#133a34',
    },
    snakeCell: {
        position: 'absolute',
        width: CELL_SIZE,
        height: CELL_SIZE,
        borderWidth: 0.5,
        borderColor: 'rgba(255,255,255,0.05)',
    },
    snakeHead: { backgroundColor: '#9affac' },
    snakeBody: { backgroundColor: '#54d778' },
    snakeFood: {
        backgroundColor: '#ff7a7a',
        borderRadius: 4,
        borderColor: '#ffd5d5',
        borderWidth: 1,
    },
    gameOverOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.5)',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
    },
    gameOverText: { color: '#fff', fontSize: 18, fontWeight: '900' },
    gameStartBtn: {
        backgroundColor: 'rgba(0,0,0,0.28)',
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    gameStartText: { color: '#fff', fontSize: 12, fontWeight: '800' },
    speakingDots: {
        position: 'absolute', bottom: 8,
        backgroundColor: 'rgba(0,0,0,0.15)',
        borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4,
    },
    speakingDotsText: { color: '#fff', fontSize: 14, letterSpacing: 4 },
    topControls: {
        position: 'absolute', top: 10, right: 12,
        flexDirection: 'row', gap: 6,
        backgroundColor: 'rgba(0,0,0,0.16)',
        borderRadius: 999,
        paddingHorizontal: 6,
        paddingVertical: 6,
    },
    controlBtn: {
        backgroundColor: 'rgba(255,255,255,0.22)',
        borderRadius: 999,
        paddingHorizontal: 11,
        paddingVertical: 6,
    },
    controlBtnText: { fontSize: 13, fontWeight: '800', color: '#fff' },
    chatArea: {
        flex: 1,
        backgroundColor: '#eafaf6',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingTop: 10,
        overflow: 'hidden',
        shadowColor: '#1a3d39',
        shadowOpacity: 0.18,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: -4 },
        elevation: 5,
    },
    dragHandleWrap: {
        alignItems: 'center',
        paddingTop: 6,
        paddingBottom: 2,
    },
    dragHandle: {
        width: 54,
        height: 6,
        borderRadius: 99,
        backgroundColor: '#9acac1',
    },
    dragText: {
        marginTop: 4,
        fontSize: 11,
        color: '#3d7a70',
        fontWeight: '700',
    },
    statusRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 8,
        marginBottom: 6,
        paddingHorizontal: 10,
    },
    statusPill: {
        backgroundColor: '#cfeee8',
        color: '#24554d',
        fontSize: 11,
        fontWeight: '700',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        overflow: 'hidden',
    },
    errorBanner: {
        backgroundColor: '#fdecea', borderColor: '#f44336', borderWidth: 1,
        marginHorizontal: 12, marginBottom: 6, borderRadius: 8, padding: 8,
    },
    errorText: {
        fontSize: 12, color: '#c62828',
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    typingRow: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 20, paddingBottom: 4,
    },
    typingText: { fontSize: 13, color: '#3b8f82', fontStyle: 'italic', fontWeight: '600' },
    messageList: { paddingHorizontal: 16, paddingBottom: 8 },
    bubble: {
        maxWidth: '82%', marginVertical: 6,
        paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18,
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
    },
    bmoBubble: { alignSelf: 'flex-start', backgroundColor: '#76D1C1', borderBottomLeftRadius: 4 },
    userBubble: { alignSelf: 'flex-end', backgroundColor: '#3a8a7d', borderBottomRightRadius: 4 },
    bmoLabel: { fontSize: 10, fontWeight: '700', color: '#2a6d63', marginBottom: 2, letterSpacing: 1 },
    bubbleText: { fontSize: 15, lineHeight: 22 },
    bmoText: { color: '#1a3d39' },
    userText: { color: '#fff' },
    rtlText: { textAlign: 'right', writingDirection: 'rtl' },
    inputRow: {
        flexDirection: 'row', alignItems: 'flex-end',
        paddingHorizontal: 12, paddingVertical: 10,
        borderTopWidth: 1, borderTopColor: '#c2ebe4', backgroundColor: '#eafaf6',
    },
    input: {
        flex: 1, backgroundColor: '#fff', borderRadius: 20,
        paddingHorizontal: 16, paddingVertical: 10,
        fontSize: 15, color: '#1a3d39', maxHeight: 100,
        borderWidth: 1.5, borderColor: '#76D1C1',
    },
    inputRtl: { textAlign: 'right' },
    sendBtn: {
        marginLeft: 10, backgroundColor: '#E85D75',
        width: 44, height: 44, borderRadius: 22,
        justifyContent: 'center', alignItems: 'center',
    },
    sendBtnDisabled: { backgroundColor: '#aaa' },
    sendBtnText: { color: '#fff', fontSize: 16, marginLeft: 2 },
});