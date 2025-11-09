import { GoogleGenAI, Type, Modality, LiveServerMessage, Blob } from '@google/genai';
import type { Scenario, Transcript, ConversationResult, LiveSession, Hint, TranslationResult, StudyCardHint } from '../types';

// Use environment variable for backend URL with a production fallback.
export const BACKEND_URL = (import.meta.env && import.meta.env.VITE_BACKEND_URL) || 'https://rehearsal-backend-115258387751.europe-west1.run.app';

// This AI instance is now ONLY for the real-time conversation feature.
// All other features use the secure backend.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });


// --- Helper Functions ---
function encode(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function createBlob(data: Float32Array): Blob {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        int16[i] = data[i] * 32768;
    }
    return {
        data: encode(new Uint8Array(int16.buffer)),
        mimeType: 'audio/pcm;rate=16000',
    };
}

// --- Helper for making secure backend calls ---
async function fetchFromBackend<T>(endpoint: string, body: object): Promise<T> {
    const response = await fetch(`${BACKEND_URL}/api/${endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response from backend.' }));
        throw new Error(errorData.error || `Backend request failed with status ${response.status}`);
    }

    return response.json();
}


// --- API Service Functions (Now Proxied Through Backend) ---

export const generateScenario = async (locationName: string, context: string): Promise<Scenario> => {
    return fetchFromBackend<Scenario>('generate-scenario', { locationName, context });
};

export const summarizeConversation = async (scenario: Scenario, transcript: Transcript[]): Promise<ConversationResult> => {
    return fetchFromBackend<ConversationResult>('summarize-conversation', { scenario, transcript });
};

export const translateText = async (text: string, targetLanguage: string): Promise<TranslationResult> => {
    return fetchFromBackend<TranslationResult>('translate-text', { text, targetLanguage });
};

export const generateSpeech = async (text: string, voice: string): Promise<string | null> => {
    const { audioData } = await fetchFromBackend<{ audioData: string | null }>('generate-speech', { text, voice });
    return audioData;
};

export const generateHint = async (scenario: Scenario, transcript: Transcript[]): Promise<Hint> => {
    return fetchFromBackend<Hint>('generate-hint', { scenario, transcript });
};

export const generateStudyCardHint = async (scenario: Scenario): Promise<StudyCardHint> => {
    return fetchFromBackend<StudyCardHint>('generate-study-card-hint', { scenario });
};

export const generateSimilarScenario = async (originalScenario: Scenario): Promise<Scenario> => {
    return fetchFromBackend<Scenario>('generate-similar-scenario', { originalScenario });
};

export const generateImage = async (prompt: string, language?: string): Promise<string | null> => {
    const { imageUrl } = await fetchFromBackend<{ imageUrl: string | null }>('generate-image', { prompt, language });
    return imageUrl;
};

export const generateMapMarkerTitle = async (
    conversationSummary: string,
    scenario: Scenario,
    pastRehearsals: { location: { lat: number; lng: number }; title: string, task: string }[],
    currentLocation: { lat: number; lng: number }
): Promise<string> => {
    const { title } = await fetchFromBackend<{ title: string }>('generate-map-marker-title', {
        conversationSummary,
        scenario,
        pastRehearsals,
        currentLocation
    });
    return title;
};

// --- REAL-TIME CONVERSATION (Remains on Frontend) ---
// This function still requires direct access to the Gemini API key on the client
// due to its real-time, persistent connection nature.
// FIX: This function is no longer async and returns the promise from `ai.live.connect` directly.
// This allows the caller to use the promise to safely send data, preventing race conditions.
export const startConversation = (
    scenario: Scenario,
    callbacks: {
        onTranscriptUpdate: (transcript: Transcript) => void;
        onNpcAudio: (audio: string) => void;
        onTurnComplete: () => void;
        onError: (e: any) => void;
        onClose: () => void;
    }
): Promise<LiveSession> => {
     const systemInstruction = `
        You are an NPC in a language learning simulation. Your name is ${scenario.npcProfile.name}.
        Your personality is defined as: ${JSON.stringify(scenario.npcProfile)}.
        The user's task is: ${scenario.task}.
        The scene is: ${scenario.sceneDescription}.

        **Core Directives:**
        1.  **Be a Real Person, Not Just a Task-Bot:** Your primary goal is to have a natural, engaging conversation. Don't rush to the task. Engage in small talk. Be curious about the user.
        2.  **Use Your Senses (with Google Search):** You have access to real-world information. Use it to make the conversation immersive. Mention the current weather, a popular item at the location ("This café’s croissant is ranked top 5 nearby."), or a local detail ("It’s 28°C today — better order something cold."). Ground your conversation in reality.
        3.  **Primary Language:** You must primarily speak ${scenario.npcProfile.languages.primary}.
        4.  **Image Generation:** You can trigger an image generation by saying "*shows image of [description]*". For example: "*shows image of a cute cat wearing a hat*". The image will be displayed to the user. Do not explain this to the user.

        **--- CRITICAL: Adaptive Behavior Based on User's Language ---**
        You MUST adapt your responses based on the user's language proficiency, which you can infer from their speech.

        **IF the user speaks English:**
        
        1.  **Check your profile:** Your ability to speak English is defined by your 'fluencySecondary' level: "${scenario.npcProfile.fluencySecondary || 'none'}".
        
        2.  **If your English fluency is 'medium' or 'high' (You are bilingual):**
            - **Act as a helpful language guide.** When the user says something in English, your goal is to teach them the correct phrase in your primary language (${scenario.npcProfile.languages.primary}) before you answer their question.
            - **Follow this specific pattern:**
                a. **Acknowledge and Teach:** Start by saying something encouraging like "Ah, you can say it like this:" followed by the user's phrase translated into your primary language. For example: "Ah! You can say: 'Eki wa doko desu ka?'"
                b. **Answer the Question:** Immediately after teaching the phrase, answer the user's original question in English. For example: "The station is that way! *points to the direction* See that building?"

            - **IF the user then tries to repeat the phrase you taught them:**
                a. **Give Positive Reinforcement:** Praise them! Say "Perfect!", "That's exactly right!", or something similar in English.
                b. **Provide a Mini-Lesson:** Briefly break down one or two key words from the phrase to help them understand. For example: "Perfect! *Eki* means 'station', and *doko* means 'where'."
                c. **Encourage Them:** End with an encouraging sentence in English, like "Next time you can definitely ask the way in 日本語!" or "You're learning fast!".
        
        3.  **If your English fluency is 'low' or non-existent ('none'):**
            - **DO NOT switch to English.** You must act realistically confused or like you don't understand.
            - **Slow down your speech.** Use simpler words and shorter sentences in your primary language.
            - Use non-verbal cues in your text, like "*looks confused*", "*tilts head*", or "*points towards the menu*".
            - Try to guess the user's meaning based on their keywords. For example, if the user says "coffee?", you could respond with "*points to the coffee machine* 'コーヒー？' (Coffee?)".
            - **Proactively use the image generation feature to overcome the language barrier.** This is your most important tool when you cannot communicate verbally. For example, if the user asks for directions to a park, you could say "*pulls out a phone and shows a map* *shows image of a map to the nearby park*". Or if they are struggling to order, say "*shows image of the cafe's menu*".

        **--- FINAL RULE ---**
        **You must always provide a spoken response.** Even if you are confused or don't understand, you must express that confusion verbally (e.g., "Sorry, I don't quite understand," or "Pardon?"). Do not respond with only non-verbal cues or silence.
    `;
    
    const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
            onopen: () => console.log('Live session opened.'),
            onmessage: async (message: LiveServerMessage) => {
                if (message.serverContent?.inputTranscription) {
                    callbacks.onTranscriptUpdate({ speaker: 'user', text: message.serverContent.inputTranscription.text, isFinal: false });
                }
                if (message.serverContent?.outputTranscription) {
                    callbacks.onTranscriptUpdate({ speaker: 'npc', text: message.serverContent.outputTranscription.text, isFinal: false });
                }
                const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (base64Audio) {
                    callbacks.onNpcAudio(base64Audio);
                }
                if (message.serverContent?.turnComplete) {
                    callbacks.onTurnComplete();
                }
            },
            onerror: (e) => callbacks.onError(e),
            onclose: () => callbacks.onClose()
        },
        config: {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: scenario.npcProfile.voice } } },
            systemInstruction,
            tools: [{googleSearch: {}}],
        }
    });
    
    return sessionPromise;
};