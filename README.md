# Bimo

Bimo is an Expo React Native app built around a BMO-inspired character UI. The app combines a chat interface, animated character rendering, text-to-speech playback, language switching, and a small Snake mini-game inside the character's screen.

## What this project does

- Presents a BMO-style device shell with an animated face, controls, and screen.
- Lets you chat with a BMO persona in English or Arabic.
- Uses Gemini for text responses and supports multiple TTS paths.
- Includes a built-in Snake game rendered inside BMO's screen.
- Supports mute, voice presets, and model/provider switching from the UI.

## Tech Stack

- Expo SDK 54
- React Native 0.81
- React 19
- TypeScript
- `react-native-reanimated` for motion
- `react-native-svg` for the character shell
- `expo-av` and `expo-speech` for audio playback
- Gemini and ElevenLabs APIs for AI and speech

## Main Runtime Flow

1. `App.tsx` mounts the main chat screen.
2. `components/BmoChatScreen.tsx` manages chat, game state, language, audio, and network calls.
3. `components/BmoFace.tsx` draws and animates the BMO shell and exposes the on-screen controls.
4. `server/tts-proxy.js` is a standalone local proxy for Gemini TTS requests.

## Features

### Chat

- Sends user prompts to Gemini.
- Keeps a short rolling conversation history to avoid context overflow.
- Parses mood tags like `[HAPPY]`, `[SURPRISED]`, `[IDLE]`, and `[THINKING]` from model output.
- Displays assistant and user bubbles with basic RTL handling for Arabic text.

### Voice

- Gemini text responses can be paired with generated audio.
- TTS provider can be cycled between Gemini, ElevenLabs, and Expo speech.
- Voice presets tune pitch, rate, bitcrushing, and optional ring modulation for a toy-like BMO effect.
- Muting stops playback and suppresses UI sounds.

### Character UI

- Animated BMO shell is rendered with SVG.
- Eyes, mouth, and body motion react to mood changes.
- The chat panel can be dragged to reveal more of the game area.

### Snake Game

- The on-screen BMO controls can start and stop Snake.
- D-pad buttons and swipe gestures control direction.
- The game tracks score and best score.
- Game over state shows a restart prompt.

## Project Structure

- `App.tsx` - app entry point that renders the main screen.
- `components/BmoChatScreen.tsx` - chat UI, Gemini integration, TTS, and Snake game logic.
- `components/BmoFace.tsx` - animated BMO shell and control hit targets.
- `constants/Colors.ts` - shared colors for the face and screen.
- `server/tts-proxy.js` - local Express proxy for Gemini TTS.
- `assets/` - app icons, splash image, and related assets.

## Setup

1. Install dependencies.

```bash
npm install
```

2. Create a `.env` file at the project root.

```env
EXPO_PUBLIC_GEMINI_API_KEY=your_gemini_api_key
EXPO_PUBLIC_ELEVENLABS_API_KEY=your_elevenlabs_api_key
EXPO_PUBLIC_ELEVENLABS_VOICE_ID=your_voice_id
EXPO_PUBLIC_TTS_PROXY_URL=http://your-local-ip:8788

GEMINI_API_KEY=your_gemini_api_key
```

3. Start the Expo app.

```bash
npm start
```

4. Optional: start the local TTS proxy.

```bash
npm run proxy:tts
```

## Environment Variables

- `EXPO_PUBLIC_GEMINI_API_KEY` - used by the app for Gemini chat and Gemini TTS.
- `EXPO_PUBLIC_ELEVENLABS_API_KEY` - used by the app for ElevenLabs TTS.
- `EXPO_PUBLIC_ELEVENLABS_VOICE_ID` - ElevenLabs voice ID used by the app.
- `EXPO_PUBLIC_TTS_PROXY_URL` - present in the repo, but not currently read by the app code.
- `GEMINI_API_KEY` - used by `server/tts-proxy.js`.

Important: keep API keys out of version control.

## Scripts

- `npm start` - start the Expo dev server.
- `npm run android` - open the app on Android.
- `npm run ios` - open the app on iOS.
- `npm run web` - open the app in a browser.
- `npm run proxy:tts` - start the Gemini TTS proxy on port `8788`.

## Notes

- The app currently talks directly to Gemini and ElevenLabs for AI and speech. The proxy exists as an optional local service.
- The BMO system prompt intentionally keeps the character in-universe and enforces mood tags.
- The app expects network access and valid API keys to generate replies and audio.
- The `.env` file in this workspace contains live secrets. I did not copy any secret values into this README.

## File Map

- [App.tsx](App.tsx)
- [components/BmoChatScreen.tsx](components/BmoChatScreen.tsx)
- [components/BmoFace.tsx](components/BmoFace.tsx)
- [constants/Colors.ts](constants/Colors.ts)
- [server/tts-proxy.js](server/tts-proxy.js)
- [package.json](package.json)