require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenAI, Type, Modality } = require('@google/genai');

const app = express();
const port = process.env.PORT || 3001;

// --- Middleware ---
app.use(cors()); // Allow requests from your frontend
app.use(express.json()); // Allow parsing of JSON request bodies

// --- Root/Health Check Endpoint ---
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Rehearsal Backend Status</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #1a202c; color: #e2e8f0; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .container { text-align: center; padding: 2rem; background-color: #2d3748; border-radius: 0.5rem; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05); }
        h1 { color: #48bb78; font-size: 2.25rem; }
        p { font-size: 1.125rem; color: #a0aec0; }
        .api-status { font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>✅ Rehearsal Backend is Running</h1>
        <p>The API service is active and ready to receive requests.</p>
        <p class="api-status">API endpoints are available under /api/*</p>
      </div>
    </body>
    </html>
  `);
});


// --- Secure Gemini API Initialization ---
if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable is not set.");
}
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const MODEL_FLASH = 'gemini-2.5-flash';
const VALID_VOICES = ['Kore', 'Puck', 'Charon', 'Zephyr', 'Fenrir'];


// --- API Proxy Endpoints ---

// Generic handler to reduce boilerplate
async function handleGeminiRequest(req, res, promptGenerator, schema) {
    try {
        const prompt = promptGenerator(req.body);
        const config = schema ? { responseMimeType: 'application/json', responseSchema: schema } : {};
        
        const response = await ai.models.generateContent({
            model: MODEL_FLASH,
            contents: prompt,
            config: config,
        });

        const result = schema ? JSON.parse(response.text.trim()) : response.text.trim();
        res.json(result);
    } catch (error) {
        console.error(`Error in endpoint:`, error);
        res.status(500).json({ error: error.message || 'An internal server error occurred.' });
    }
}

// Endpoint to securely provide the Maps API key
app.get('/api/config', (req, res) => {
  const mapsApiKey = process.env.MAPS_API_KEY;
  if (!mapsApiKey) {
    console.error("MAPS_API_KEY is not defined in the environment.");
    return res.status(500).json({ error: 'Server configuration error: Maps API Key is missing.' });
  }
  res.json({
    mapsApiKey: mapsApiKey
  });
});

app.post('/api/generate-scenario', async (req, res) => {
    const { locationName, context } = req.body;
    const prompt = `
        You are a scenario generator for a language learning application called "Rehearsal".
        Your goal is to create an immersive, realistic, and culturally appropriate scenario for a user practicing a new language.
        The user is currently exploring a specific location using Google Street View.
        **CRITICAL INSTRUCTION: The user's geographic coordinates are the absolute source of truth.**
        - **User's Coordinates:** ${context}
        - **Location Name (Potentially unreliable):** ${locationName}
        Your task is to analyze the **User's Coordinates** to determine the *actual* environment the user is in. The \`Location Name\` might be generic (e.g., "Street", "Unnamed Road") or incorrect. You must base your scenario on what would plausibly exist at those exact coordinates.
        **Step-by-step process:**
        1.  **Analyze Coordinates:** First, determine the most likely type of establishment or point of interest at \`${context}\`. Is it a cafe, a shop, a bus stop, a park entrance, a residential building, a temple? Be specific.
        2.  **Create Scenario:** Based on your analysis of the coordinates, create a scenario. Do not invent a location that isn't there. The scenario must be grounded in the reality of the Street View image.
        3.  **Generate a simple, clear, and actionable task** for the user to complete by talking to a local NPC.
        4.  **Create a profile for the Non-Player Character (NPC)** they will interact with. The NPC's voice **MUST** be one of these exact values: ${VALID_VOICES.join(', ')}.
        5.  **Write a brief, evocative description of the scene** to set the mood, based on a typical view at that location.
        6.  **Decide who starts the conversation** (user or NPC). If the NPC starts, provide an opening line.
        The NPC profile must include:
        - name (culturally appropriate for the location)
        - gender ('male', 'female', 'neutral')
        - voice (one of: ${VALID_VOICES.join(', ')}). **IMPORTANT: The selected voice MUST match the specified gender.** For example, a male-sounding name for a 'male' gender.
        - languages (e.g., { primary: 'Japanese', secondary: 'English' })
        - fluency for each language ('low', 'medium', 'high')
        - personality traits: patience, helpfulness ('low', 'medium', 'high')
        - accent ('local', 'neutral', 'heavy')
        - a unique quirk (a short, interesting personality trait, e.g., "Always polishing their glasses.")
        The user's task should be practical for a visitor, like asking for directions, ordering food, or asking about a local feature.
        Return the response as a JSON object matching the provided schema. Do not include any text outside the JSON object.
    `;
    const schema = { /* Schema from geminiService.ts */ }; // (Schema is embedded in the prompt logic below)
    
     try {
        const response = await ai.models.generateContent({
            model: MODEL_FLASH,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        locationName: { type: Type.STRING },
                        locationType: { type: Type.STRING },
                        task: { type: Type.STRING },
                        npcProfile: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING },
                                gender: { type: Type.STRING, enum: ['male', 'female', 'neutral'] },
                                voice: { type: Type.STRING, enum: VALID_VOICES },
                                languages: {
                                    type: Type.OBJECT,
                                    properties: {
                                        primary: { type: Type.STRING },
                                        secondary: { type: Type.STRING },
                                    },
                                    required: ['primary']
                                },
                                fluencyPrimary: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
                                fluencySecondary: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
                                patience: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
                                helpfulness: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
                                accent: { type: Type.STRING, enum: ['local', 'neutral', 'heavy'] },
                                quirk: { type: Type.STRING },
                            },
                            required: ['name', 'gender', 'voice', 'languages', 'fluencyPrimary', 'patience', 'helpfulness', 'accent', 'quirk']
                        },
                        sceneDescription: { type: Type.STRING },
                        conversationStarter: { type: Type.STRING, enum: ['user', 'npc'] },
                        openingLine: { type: Type.STRING, nullable: true },
                    },
                    required: ['locationName', 'locationType', 'task', 'npcProfile', 'sceneDescription', 'conversationStarter', 'openingLine']
                },
            },
        });
        const scenarioData = JSON.parse(response.text.trim());
        if (!VALID_VOICES.includes(scenarioData.npcProfile.voice)) {
            scenarioData.npcProfile.voice = 'Zephyr'; // Fallback voice
        }
        res.json(scenarioData);
    } catch (error) {
        console.error(`Error in /api/generate-scenario:`, error);
        res.status(500).json({ error: error.message || 'Failed to generate scenario.' });
    }
});

app.post('/api/summarize-conversation', async (req, res) => {
    const { scenario, transcript } = req.body;
    const meaningfulTranscript = transcript.filter(t => t.text.trim() !== '');
    const prompt = `
        You are an encouraging and insightful language learning coach. Your tone is positive and focuses on progress, not perfection.
        Analyze the following conversation. The user's goal was: "${scenario.task}"
        The NPC's primary language is: ${scenario.npcProfile.languages.primary}

        Transcript:
        ${meaningfulTranscript.map(t => `${t.speaker === 'user' ? 'User' : 'NPC'}: ${t.text}`).join('\n')}

        **Your Analysis Task:**
        Your response MUST be a JSON object. Do not include any text outside of the JSON.

        1.  **Calculate Conversation Turns:** Count the number of times the user spoke. This is the 'conversationTurns' value.
        2.  **Estimate Immersion Score:** Analyze the user's speech. Estimate the percentage of their conversation that was in the target language (${scenario.npcProfile.languages.primary}) vs. English. A user speaking only the target language is 100. A user speaking only English is 0. This is the 'immersionScore'.
        3.  **Identify What Went Well:** Find 1-2 specific positive things the user did. Did they use a new vocabulary word correctly? Did they ask a good question? Did they self-correct? Frame this as positive reinforcement. This is the 'whatWentWell' array.
        4.  **Suggest What to Try Next:** Provide 1-2 gentle, actionable tips for improvement. Avoid harsh criticism. Instead of "Your grammar was wrong," say "Next time, you could try phrasing it like this for a more natural sound." This is the 'whatToTryNext' array.
        5.  **Write a Final Summary:** Write a single, encouraging sentence summarizing the outcome of the conversation. This is the 'finalSummary'.
        6.  **Suggest Continuation (If Applicable):** If the user didn't fully complete their original task ("${scenario.task}"), provide a simple phrase in the target language they could use to continue, along with an explanation. If they did complete it, these fields should be null.

        The goal is to make the user feel confident and eager to try another conversation, celebrating their effort and participation above all else.
    `;
    const schema = {
        type: Type.OBJECT,
        properties: {
            finalSummary: { type: Type.STRING },
            whatWentWell: { type: Type.ARRAY, items: { type: Type.STRING } },
            whatToTryNext: { type: Type.ARRAY, items: { type: Type.STRING } },
            conversationTurns: { type: Type.NUMBER },
            immersionScore: { type: Type.NUMBER },
            suggestedContinuation: { type: Type.STRING, nullable: true },
            suggestedContinuationExplanation: { type: Type.STRING, nullable: true },
        },
        required: ['finalSummary', 'whatWentWell', 'whatToTryNext', 'conversationTurns', 'immersionScore']
    };
    await handleGeminiRequest(req, res, () => prompt, schema);
});

app.post('/api/translate-text', async (req, res) => {
    const { text, targetLanguage } = req.body;
    const prompt = `
      You are a helpful translation assistant for a language learner.
      Translate the following text into ${targetLanguage}.
      In addition to the translation, provide:
      1. A simple phonetic pronunciation guide for the translated text.
      2. A brief, useful tip about the usage of a key word or phrase in the translation.
      Text to translate: "${text}"
      Return a JSON object with the fields: "translation", "pronunciation", "tip".
    `;
    const schema = {
        type: Type.OBJECT,
        properties: {
            translation: { type: Type.STRING },
            pronunciation: { type: Type.STRING },
            tip: { type: Type.STRING },
        },
        required: ['translation', 'pronunciation', 'tip']
    };
    await handleGeminiRequest(req, res, () => prompt, schema);
});

app.post('/api/generate-speech', async (req, res) => {
    const { text, voice } = req.body;
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
            },
        });
        res.json({ audioData: response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ?? null });
    } catch (error) {
        console.error(`Error in /api/generate-speech:`, error);
        res.status(500).json({ error: error.message || 'Failed to generate speech.' });
    }
});

app.post('/api/generate-hint', async (req, res) => {
    const { scenario, transcript } = req.body;
    const prompt = `
        You are a helpful AI language tutor. A user is in a conversation simulation and seems to be stuck.
        Their task is: "${scenario.task}"
        The conversation so far:
        ${transcript.map(t => `${t.speaker}: ${t.text}`).join('\n')}
        Your goal is to provide a single, highly relevant suggestion to help them continue.
        The suggestion should be a phrase in the NPC's primary language: ${scenario.npcProfile.languages.primary}.
        Please provide:
        1. "suggestion": The suggested phrase in ${scenario.npcProfile.languages.primary}.
        2. "translation": The English translation of the phrase.
        3. "pronunciation": A simple phonetic guide.
        4. "explanation": A very brief (1 sentence) explanation of why this is a good thing to say now.
        Return a JSON object with these fields.
    `;
    const schema = {
        type: Type.OBJECT,
        properties: {
            suggestion: { type: Type.STRING },
            translation: { type: Type.STRING },
            pronunciation: { type: Type.STRING },
            explanation: { type: Type.STRING },
        },
        required: ['suggestion', 'translation', 'pronunciation', 'explanation']
    };
    await handleGeminiRequest(req, res, () => prompt, schema);
});

app.post('/api/generate-study-card-hint', async (req, res) => {
    const { scenario } = req.body;
    const prompt = `
        You are a language learning assistant. Based on the following scenario, create a "study card" with key vocabulary and useful phrases.
        The user's task is: "${scenario.task}"
        The location is: "${scenario.locationName}" (${scenario.locationType})
        The primary language is: ${scenario.npcProfile.languages.primary}
        Generate a JSON object containing:
        1. "vocabulary": An array of 3-5 key nouns or verbs relevant to the task and location. Each entry should have "term" (in ${scenario.npcProfile.languages.primary}) and "translation" (in English).
        2. "phrases": An array of 2-3 useful, complete phrases for this situation. Each entry should have "term" and "translation".
    `;
    const schema = {
        type: Type.OBJECT,
        properties: {
            vocabulary: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { term: { type: Type.STRING }, translation: { type: Type.STRING } }, required: ['term', 'translation'] } },
            phrases: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { term: { type: Type.STRING }, translation: { type: Type.STRING } }, required: ['term', 'translation'] } },
        },
        required: ['vocabulary', 'phrases']
    };
    await handleGeminiRequest(req, res, () => prompt, schema);
});

app.post('/api/generate-similar-scenario', async (req, res) => {
    const { originalScenario } = req.body;
    const prompt = `
      You are a scenario generator for a language learning app.
      The user just completed this scenario:
      ${JSON.stringify(originalScenario)}
      Your task is to create a new, similar but distinct scenario. It should be a logical next step or a related task in the same location or context.
      The new scenario must follow the exact same JSON structure as the original.
      The NPC's voice must be one of: ${VALID_VOICES.join(', ')}.
    `;
    // Reusing the same schema as the original scenario generation
    const schema = { /* same schema as generate-scenario */ };
    try {
        const response = await ai.models.generateContent({
            model: MODEL_FLASH,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: { /* Re-pasting the full schema for clarity */
                    type: Type.OBJECT,
                    properties: {
                        locationName: { type: Type.STRING },
                        locationType: { type: Type.STRING },
                        task: { type: Type.STRING },
                        npcProfile: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING },
                                gender: { type: Type.STRING, enum: ['male', 'female', 'neutral'] },
                                voice: { type: Type.STRING, enum: VALID_VOICES },
                                languages: {
                                    type: Type.OBJECT, properties: { primary: { type: Type.STRING }, secondary: { type: Type.STRING }, }, required: ['primary']
                                },
                                fluencyPrimary: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
                                fluencySecondary: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
                                patience: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
                                helpfulness: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
                                accent: { type: Type.STRING, enum: ['local', 'neutral', 'heavy'] },
                                quirk: { type: Type.STRING },
                            },
                            required: ['name', 'gender', 'voice', 'languages', 'fluencyPrimary', 'patience', 'helpfulness', 'accent', 'quirk']
                        },
                        sceneDescription: { type: Type.STRING },
                        conversationStarter: { type: Type.STRING, enum: ['user', 'npc'] },
                        openingLine: { type: Type.STRING, nullable: true },
                    },
                    required: ['locationName', 'locationType', 'task', 'npcProfile', 'sceneDescription', 'conversationStarter', 'openingLine']
                },
            },
        });
        const scenarioData = JSON.parse(response.text.trim());
        if (!VALID_VOICES.includes(scenarioData.npcProfile.voice)) {
            scenarioData.npcProfile.voice = 'Zephyr';
        }
        res.json(scenarioData);
    } catch (error) {
        console.error(`Error in /api/generate-similar-scenario:`, error);
        res.status(500).json({ error: error.message || 'Failed to generate similar scenario.' });
    }
});

app.post('/api/generate-image', async (req, res) => {
    const { prompt, language } = req.body;
    const fullPrompt = language && language.toLowerCase() !== 'english'
        ? `Translate this to English and then create a photorealistic image: "${prompt}"`
        : prompt;
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: [{ text: fullPrompt }] },
            config: { responseModalities: [Modality.IMAGE] },
        });
        let imageUrl = null;
        for (const part of response.candidates?.[0]?.content?.parts ?? []) {
            if (part.inlineData) {
                imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            }
        }
        res.json({ imageUrl });
    } catch (error) {
        console.error(`Error in /api/generate-image:`, error);
        res.status(500).json({ error: error.message || 'Failed to generate image.' });
    }
});

app.post('/api/generate-map-marker-title', async (req, res) => {
    const { conversationSummary, scenario, pastRehearsals, currentLocation } = req.body;

    const getDistance = (loc1, loc2) => {
        const R = 6371e3;
        const φ1 = loc1.lat * Math.PI / 180;
        const φ2 = loc2.lat * Math.PI / 180;
        const Δφ = (loc2.lat - loc1.lat) * Math.PI / 180;
        const Δλ = (loc2.lng - loc1.lng) * Math.PI / 180;
        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    };

    const nearbyRehearsals = pastRehearsals.filter(r => getDistance(currentLocation, r.location) < 100);
    let historyContext = "This is the user's first time rehearsing here.";
    if (nearbyRehearsals.length > 0) {
        const previousTasks = nearbyRehearsals.map(r => r.task);
        historyContext = `The user has rehearsed here before. Previous tasks were: [${previousTasks.map(t => `"${t}"`).join(', ')}].`;
    }

    const prompt = `
        You are an AI that creates witty, personal, and very short "map memory" titles for a language learning app.
        The tone should be like a personal, quirky journal entry, from the user's perspective (e.g., "I", "my").
        **Analyze all the information below:**
        - **Conversation Summary:** "${conversationSummary}"
        - **User's Goal:** "${scenario.task}"
        - **Location:** ${scenario.locationName} (${scenario.locationType})
        - **User's History at this Location:** ${historyContext}
        **Your Task & Rules:**
        1.  **Create a very short title (max 6 words).**
        2.  **Focus on the user's personal action or feeling.**
            *   Example: If the goal was to "order a coffee" and it was successful, a good title is "I ordered my first coffee!" or "Finally got that coffee."
            *   Example: If the goal was "buy strawberries" and the summary mentions practicing vocabulary, a good title is "I bought virtual strawberries!"
        3.  **Handle Repetition Smartly:**
            *   Look at the User's History. If the current goal is similar to a past goal at this location, and it's only the second or third time, make a playful, witty comment.
            *   Example: If they asked for directions here before, and they are asking for directions again, a title could be "Got lost here again." or "Still don't know my way around."
            *   If the tasks are different, or if it's the first time, just focus on the current achievement.
        **CRITICAL: Return ONLY the title string. No quotes, no extra text.**
    `;
    const title = await handleGeminiRequest({ body: {} }, { json: (data) => res.json({ title: data }) }, () => prompt);
});


// --- Start Server ---
app.listen(port, () => {
  console.log(`✅ Backend server is listening on port ${port}`);
  console.log('Secure endpoints are now active.');
});