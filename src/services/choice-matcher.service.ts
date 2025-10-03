import Fuse from "fuse.js";
import { TranscriptionResult } from "../types/common.types";
import { appLogger } from "../utils/logger";

export type ChoiceMatchResult = {
  id: string;
  content: string;
  score: number;
};

const fuseOptions: any = {
  keys: ['content'],
  threshold: 0.6, // Adjust for matching sensitivity (0 = perfect match, 1 = match anything)
  includeScore: true,
  ignoreLocation: true,
  findAllMatches: false,
};

/**
 * Matches transcribed text against available choices
 */
export async function matchTranscriptionToChoice(
  transcription: string,
  choices: Array<{ id: string; content: string }>,
  waId?: string
): Promise<ChoiceMatchResult | null> {
  const context = { 
    waId, 
    operation: 'choice_matching',
    transcription: transcription.substring(0, 100), // Limit for logging
    choicesCount: choices.length 
  };

  if (!transcription.trim() || choices.length === 0) {
    appLogger.choiceMatching({
      ...context,
      bestMatch: undefined,
      score: undefined
    });
    return null;
  }

  // Clean transcription text
  const cleanTranscription = cleanText(transcription);

  // Create Fuse instance
  const fuse = new Fuse(choices, fuseOptions);

  // Search for matches
  const results = fuse.search(cleanTranscription);

  if (results.length > 0 && results[0].score !== undefined) {
    const bestMatch = results[0];
    const matchResult: ChoiceMatchResult = {
      id: bestMatch.item.id,
      content: bestMatch.item.content,
      score: 1 - (bestMatch.score || 0), // Convert Fuse score (lower is better) to confidence (higher is better)
    };

    appLogger.choiceMatching({
      ...context,
      bestMatch: matchResult.content,
      score: matchResult.score
    });

    // Only return matches above minimum confidence threshold
    if (matchResult.score >= 0.4) {
      return matchResult;
    }
  }

  // Try exact phrase matching as fallback
  const exactMatch = findExactMatch(cleanTranscription, choices);
  if (exactMatch) {
    appLogger.choiceMatching({
      ...context,
      bestMatch: exactMatch.content,
      score: 1.0
    });
    return exactMatch;
  }

  appLogger.choiceMatching({
    ...context,
    bestMatch: undefined,
    score: undefined
  });

  return null;
}

/**
 * Enhances transcription result with choice matching
 */
export async function enhanceTranscriptionWithChoiceMatch(
  transcriptionResult: TranscriptionResult,
  choices: Array<{ id: string; content: string }>,
  waId?: string
): Promise<TranscriptionResult> {
  if (!transcriptionResult.success || !transcriptionResult.text) {
    return transcriptionResult;
  }

  const matchResult = await matchTranscriptionToChoice(
    transcriptionResult.text,
    choices,
    waId
  );

  return {
    ...transcriptionResult,
    matchedChoice: matchResult || undefined
  };
}

/**
 * Cleans text for better matching
 */
function cleanText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    // Remove common filler words in multiple languages
    .replace(/\b(um|uh|eh|ah|hmm|er|erm|like|you know|então|né|tipo|assim)\b/gi, ' ')
    // Remove punctuation and extra spaces
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Attempts to find exact phrase matches
 */
function findExactMatch(
  cleanTranscription: string,
  choices: Array<{ id: string; content: string }>
): ChoiceMatchResult | null {
  for (const choice of choices) {
    const cleanChoice = cleanText(choice.content);
    
    // Check if transcription contains the choice or vice versa
    if (cleanTranscription.includes(cleanChoice) || cleanChoice.includes(cleanTranscription)) {
      return {
        id: choice.id,
        content: choice.content,
        score: 1.0
      };
    }
  }

  return null;
}

/**
 * Gets matching statistics for debugging
 */
export function getMatchingStats(
  transcription: string,
  choices: Array<{ id: string; content: string }>
): {
  cleanTranscription: string;
  choiceCount: number;
  transcriptionLength: number;
  avgChoiceLength: number;
} {
  const cleanTranscription = cleanText(transcription);
  const avgChoiceLength = choices.length > 0 
    ? Math.round(choices.reduce((sum, choice) => sum + choice.content.length, 0) / choices.length)
    : 0;

  return {
    cleanTranscription,
    choiceCount: choices.length,
    transcriptionLength: cleanTranscription.length,
    avgChoiceLength
  };
}