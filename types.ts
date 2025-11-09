import type { Blob } from '@google/genai';

// Fix for `import.meta.env` TypeScript error. This makes TypeScript aware of Vite's environment variables.
declare global {
    // FIX: Replaced the conflicting `var process` declaration with the standard
    // way of augmenting the global NodeJS namespace. This avoids type clashes
    // with `@types/node` which is implicitly included in the project,
    // resolving the "Subsequent variable declarations must have the same type" error.
    namespace NodeJS {
      interface ProcessEnv {
        API_KEY?: string;
      }
    }

    interface ImportMetaEnv {
        readonly VITE_BACKEND_URL: string;
    }

    interface ImportMeta {
        readonly env: ImportMetaEnv;
    }
}

export enum ConversationStatus {
    Idle = 'idle',
    Generating = 'generating',
    Briefing = 'briefing',
    Ready = 'ready',
    Active = 'active',
    Summarizing = 'summarizing',
    PausedForFeedback = 'paused',
    Error = 'error',
}

export interface NpcProfile {
    name: string;
    gender: 'male' | 'female' | 'neutral';
    voice: string;
    languages: {
        primary: string;
        secondary?: string;
    };
    fluencyPrimary: 'low' | 'medium' | 'high';
    fluencySecondary?: 'low' | 'medium' | 'high';
    patience: 'low' | 'medium' | 'high';
    helpfulness: 'low' | 'medium' | 'high';
    accent: 'local' | 'neutral' | 'heavy';
    quirk: string;
}

export interface Scenario {
    locationName: string;
    locationType: string;
    task: string;
    npcProfile: NpcProfile;
    sceneDescription: string;
    conversationStarter: 'user' | 'npc';
    openingLine: string | null;
}

export interface Transcript {
    speaker: 'user' | 'npc';
    text: string;
    isFinal: boolean;
    imageUrl?: string; // Added to support inline images
}

export interface ConversationResult {
    finalSummary: string; // A one-sentence outcome summary.
    whatWentWell: string[]; // Positive reinforcement.
    whatToTryNext: string[]; // Constructive, encouraging tips.
    conversationTurns: number; // Total number of back-and-forth exchanges.
    immersionScore: number; // A percentage (0-100) of target language usage vs. English.
    suggestedContinuation?: string;
    suggestedContinuationExplanation?: string;
}


export interface Hint {
    suggestion: string;
    translation: string;
    pronunciation: string;
    explanation: string;
}

export interface TranslationResult {
    translation: string;
    pronunciation: string;
    tip: string;
}

// --- NEW: Types for structured Study Card hints ---
export interface StudyCardEntry {
    term: string;
    translation: string;
}

export interface StudyCardHint {
    vocabulary: StudyCardEntry[];
    phrases: StudyCardEntry[];
}
// --- END NEW ---

export interface LiveSession {
    sendRealtimeInput(input: { media: Blob }): void;
    close(): void;
}