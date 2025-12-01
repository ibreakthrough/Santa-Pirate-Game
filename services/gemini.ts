/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function generatePirateEvent(eventName: string, context: string): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `You are the narrator of a pirate game where Santa is the captain. 
      The player just performed this action: ${eventName}. 
      Context: ${context}.
      Generate a funny, pirate-themed, one-sentence reaction or loot description.
      Example: "Arrr! The elves of Palm Island traded yer socks for a golden coconut!"`,
      config: {
        temperature: 1,
        maxOutputTokens: 50,
      },
    });

    return response.text || "Arrr! The winds carry no words today.";
  } catch (error) {
    console.error("Gemini Generation Error:", error);
    return "The sea is silent... (API Error)";
  }
}