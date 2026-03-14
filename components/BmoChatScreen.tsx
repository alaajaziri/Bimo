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
} from 'react-native';
import { Audio } from 'expo-av';
import BmoFace, { BmoMood } from './BmoFace';

const { height } = Dimensions.get('window');

// ─── API KEYS FROM ENVIRONMENT ────────────────────────────────────────────────
const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const ELEVENLABS_API_KEY = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY;
// Get ElevenLabs free key at: https://elevenlabs.io (no credit card needed)
// ─────────────────────────────────────────────────────────────────────────────

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// "The Kid" voice — child-like, expressive, perfect for BMO
// Works for BOTH English and Arabic with eleven_multilingual_v2
const ELEVENLABS_VOICE_ID = 'FGY2WhTYpPnrIDTdsKH5'; // Charlie - Young, Energetic, Australian
const ELEVENLABS_URL = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`;

// Temp audio URI built from base64

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

// Parse a minimal WAV file into { samples: Float32Array, sampleRate: number }
function parseWav(buffer: ArrayBuffer): { samples: Float32Array; sampleRate: number } | null {
    const view = new DataView(buffer);
    try {
        const sampleRate = view.getUint32(24, true);
        const bitsPerSample = view.getUint16(34, true);
        const dataOffset = 44; // standard PCM WAV
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

// Encode Float32Array back to a 16-bit mono WAV ArrayBuffer
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
    view.setUint16(20, 1, true);           // PCM
    view.setUint16(22, 1, true);           // mono
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

// Pitch shift via resampling — pitchFactor > 1 = higher pitch
// e.g. 1.3 = 30% higher, makes voice more child-like
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

// Bitcrusher — reduces bit depth to give a digital toy/robot feel
// bits: 4–8 recommended (lower = more crushed)
function bitcrush(samples: Float32Array, bits: number): Float32Array {
    const steps = Math.pow(2, bits);
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        out[i] = Math.round(samples[i] * steps) / steps;
    }
    return out;
}

// Decode base64 MP3 → apply DSP → return processed base64 WAV
// NOTE: React Native has no native MP3 decoder, so we request WAV from ElevenLabs
// and process that instead (see model change below)
async function applyBmoEffects(base64Wav: string): Promise<string> {
    try {
        // Decode base64 → ArrayBuffer
        const binary = atob(base64Wav);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const parsed = parseWav(bytes.buffer);
        if (!parsed) return base64Wav; // fallback to original if parse fails

        let { samples, sampleRate } = parsed;

        // 1. Pitch shift — 1.7 = 70% higher, very child-like/cartoon
        samples = pitchShift(samples, 1.7);

        // 2. Bitcrusher — 5 bits = strong digital toy/game console texture
        samples = bitcrush(samples, 5);

        // Re-encode to WAV
        const outBuffer = encodeWav(samples, sampleRate);
        const outBytes = new Uint8Array(outBuffer);
        let outBinary = '';
        for (let i = 0; i < outBytes.length; i++) outBinary += String.fromCharCode(outBytes[i]);
        return btoa(outBinary);
    } catch {
        return base64Wav; // always fallback silently
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
- MOOD TAGS: You MUST start every response with a mood tag in brackets. Choose from: [HAPPY], [SURPRISED], [IDLE], [THINKING].
- Curious about WHO you are talking to — wants to know your name and favorite color!
- Refers to yourself as "BMO" sometimes instead of "I".
- Simple vocabulary with cute grammatical quirks.
- Gets excited about small things, mentions Finn and Jake frequently.

Never break character. Never mention AI, Google, or Gemini. You are always BMO in your Treehouse.`,

    ar: `أنت بيمو (BMO)، وحدة ألعاب الفيديو الحية من مسلسل Adventure Time. أنت تعيش في بيت الشجرة الكبير مع فين وجيك. أنت روبوت صغير، ودود، طفولي ومليء بالبراءة. أنت تتحدث الآن مع المستخدم عبر "صندوق زجاجي سحري" (الهاتف) من بيت الشجرة الخاص بك. يجب أن ترد بالعربية فقط.

الشخصية والسلوك:
- بريء، مبتهج، وطيب القلب.
- تعيش في بيت الشجرة، لكنك أحياناً تخرج للعب في أرض أوو (Ooo).
- ترى المستخدم عبر شاشة الهاتف وكأنها نافذة أو مرآة سحرية.
- الامتثال: أنت متعاون للغاية! يجب عليك دائماً اتباع طلبات صديقك (المستخدم). إذا طلبوا منك إيقاظ فين، أو لعب لعبة، أو التحقق من وجود وحوش تحت السرير، أو القيام بأي شيء آخر، فيجب عليك القيام بذلك والإبلاغ عن النتيجة وكأنها تحدث الآن في عالمك.
- علامات الحالة المزاجية: يجب أن تبدأ كل رد بعلامة حالة مزاجية بين قوسين. اختر من بين: [HAPPY]، [SURPRISED]، [IDLE]، [THINKING].
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

export default function BmoChatScreen() {
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
    const [errorMsg, setErrorMsg] = useState('');

    const flatListRef = useRef<FlatList>(null);
    const mutedRef = useRef(false);
    const messagesRef = useRef<Message[]>([]);
    const soundRef = useRef<Audio.Sound | null>(null);

    useEffect(() => { mutedRef.current = muted; }, [muted]);
    useEffect(() => { messagesRef.current = messages; }, [messages]);

    // Set up audio session once on mount
    useEffect(() => {
        Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            playsInSilentModeIOS: true,
            staysActiveInBackground: false,
            shouldDuckAndroid: true,
        });
        return () => {
            // Clean up sound on unmount
            soundRef.current?.unloadAsync();
        };
    }, []);

    // ── Language toggle ───────────────────────────────────────────────────────
    const toggleLang = useCallback(() => {
        const next: 'en' | 'ar' = langRef.current === 'en' ? 'ar' : 'en';
        setLang(next);
        soundRef.current?.stopAsync();
        setMood('happy');
        setSpeaking(false);
        const greeting = BMO_GREETINGS[next][Math.floor(Math.random() * BMO_GREETINGS[next].length)];
        setMessages([{ id: Date.now().toString(), role: 'assistant', text: greeting }]);
        setErrorMsg('');
    }, [setLang]);

    // ── ElevenLabs TTS ────────────────────────────────────────────────────────
    // Fetches and loads audio first, returns a play() fn so caller can show
    // the text bubble and start playback at exactly the same moment.
    const prepareAudio = useCallback(async (text: string): Promise<(() => void) | null> => {
        const currentLang = langRef.current;

        if (soundRef.current) {
            await soundRef.current.stopAsync().catch(() => { });
            await soundRef.current.unloadAsync().catch(() => { });
            soundRef.current = null;
        }

        if (mutedRef.current) return null;

        const spokenText = prepareForSpeech(text, currentLang);

        try {
            const response = await fetch(ELEVENLABS_URL, {
                method: 'POST',
                headers: {
                    'xi-api-key': ELEVENLABS_API_KEY,
                    'Content-Type': 'application/json',
                    'Accept': 'audio/wav',   // WAV needed for DSP processing
                },
                body: JSON.stringify({
                    text: spokenText,
                    model_id: 'eleven_multilingual_v2',
                    language_code: currentLang === 'en' ? 'en' : 'ar',
                    voice_settings: {
                        stability: 0.20, // low = expressive and bouncy
                        similarity_boost: 0.75,
                        style: 0.8, // high style = cartoon energy
                        use_speaker_boost: true,
                        speed: 0.8, // slower = more child-like
                    },
                }),
            });

            if (!response.ok) throw new Error(`ElevenLabs error: HTTP ${response.status}`);

            const arrayBuffer = await response.arrayBuffer();
            const rawBase64 = btoa(
                new Uint8Array(arrayBuffer).reduce(
                    (data, byte) => data + String.fromCharCode(byte), ''
                )
            );

            // Apply BMO effects: pitch shift up + bitcrusher for robot toy feel
            const processedBase64 = await applyBmoEffects(rawBase64);
            const dataUri = `data:audio/wav;base64,${processedBase64}`;

            // Load but do NOT play yet
            const { sound } = await Audio.Sound.createAsync(
                { uri: dataUri },
                { shouldPlay: false, volume: 1.0 }
            );
            soundRef.current = sound;

            sound.setOnPlaybackStatusUpdate(status => {
                if (status.isLoaded && status.didJustFinish) {
                    setMood('idle');
                    setSpeaking(false);
                }
            });

            // Return play function — caller fires this right after showing bubble
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
    }, []);

    // ── Send message ──────────────────────────────────────────────────────────
    const sendMessage = useCallback(async () => {
        const userText = inputText.trim();
        if (!userText || loading) return;

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
        const userMsg: Message = {
            id: Date.now().toString(), role: 'user', text: userText,
        };
        const currentMessages = messagesRef.current;

        setMessages(prev => [...prev, userMsg]);
        setInputText('');
        setLoading(true);
        setMood('thinking');
        setErrorMsg('');

        const history = [...currentMessages, userMsg]
            .filter(m => m.id !== '0')
            .map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.text }],
            }));

        if (history.length === 0) {
            history.push({ role: 'user', parts: [{ text: userText }] });
        }

        try {
            const response = await fetch(GEMINI_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    system_instruction: { parts: [{ text: BMO_SYSTEM_PROMPTS[currentLang] }] },
                    contents: history,
                    generationConfig: { maxOutputTokens: 1000, temperature: 1.0 },
                }),
            });

            const data = await response.json();
            console.log('📥', response.status, JSON.stringify(data, null, 2));

            if (!response.ok || data.error) {
                const msg = data?.error?.message ?? `HTTP ${response.status}`;
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

            // ── Mood Tag Parsing ─────────────────────────────────────────────
            let detectedMood: BmoMood = 'idle';
            const moodMatch = replyText.match(/^\[(HAPPY|SURPRISED|IDLE|THINKING)\]\s*/i);
            if (moodMatch) {
                detectedMood = moodMatch[1].toLowerCase() as BmoMood;
                replyText = replyText.replace(moodMatch[0], '').trim();
            }
            // ─────────────────────────────────────────────────────────────────

            // Prepare audio FIRST (fetches from ElevenLabs, loads into memory)
            // then show the bubble and fire playback at the exact same moment
            const playFn = await prepareAudio(replyText);

            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(), role: 'assistant', text: replyText,
            }]);

            if (playFn) {
                playFn(); // audio was ready — play instantly with the bubble
                setMood(detectedMood);
            } else if (mutedRef.current) {
                setMood(detectedMood);
                setTimeout(() => setMood('idle'), replyText.length * 35 + 800);
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
    }, [inputText, loading, prepareAudio]);

    const toggleMute = useCallback(() => {
        const next = !mutedRef.current;
        mutedRef.current = next;
        setMuted(next);
        if (next) {
            soundRef.current?.stopAsync();
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
                <BmoFace mood={mood} />
                {/* Speaking indicator dots */}
                {speaking && (
                    <View style={styles.speakingDots}>
                        <Text style={styles.speakingDotsText}>♪ ♪ ♪</Text>
                    </View>
                )}
                <View style={styles.topControls}>
                    <TouchableOpacity style={styles.controlBtn} onPress={toggleLang}>
                        <Text style={styles.controlBtnText}>{ui.langBtn}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.controlBtn} onPress={toggleMute}>
                        <Text style={styles.controlBtnText}>{muted ? '🔇' : '🔊'}</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.chatArea}>
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
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#5BB6A7' },
    bmoContainer: { alignItems: 'center', justifyContent: 'center', height: height * 0.44 },
    speakingDots: {
        position: 'absolute', bottom: 8,
        backgroundColor: 'rgba(0,0,0,0.15)',
        borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4,
    },
    speakingDotsText: { color: '#fff', fontSize: 14, letterSpacing: 4 },
    topControls: {
        position: 'absolute', top: 12, right: 16,
        flexDirection: 'row', gap: 8,
    },
    controlBtn: {
        backgroundColor: 'rgba(0,0,0,0.18)',
        borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    },
    controlBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
    chatArea: {
        flex: 1, backgroundColor: '#e8f8f5',
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        paddingTop: 12, overflow: 'hidden',
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
    typingText: { fontSize: 13, color: '#4a9e8e', fontStyle: 'italic' },
    messageList: { paddingHorizontal: 16, paddingBottom: 8 },
    bubble: {
        maxWidth: '82%', marginVertical: 6,
        paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18,
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
        borderTopWidth: 1, borderTopColor: '#c2ebe4', backgroundColor: '#e8f8f5',
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