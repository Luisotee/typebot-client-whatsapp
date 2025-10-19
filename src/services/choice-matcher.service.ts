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

  // Try numeric matching first (e.g., "1", "um", "primeiro", "opção 1")
  const numericMatch = findNumericMatch(cleanTranscription, choices);
  if (numericMatch) {
    appLogger.choiceMatching({
      ...context,
      bestMatch: numericMatch.content,
      score: 1.0,
      matchType: 'numeric'
    });
    return numericMatch;
  }

  // Try exact phrase matching
  const exactMatch = findExactMatch(cleanTranscription, choices);
  if (exactMatch) {
    appLogger.choiceMatching({
      ...context,
      bestMatch: exactMatch.content,
      score: 1.0,
      matchType: 'exact'
    });
    return exactMatch;
  }

  // Create Fuse instance for fuzzy matching
  const fuse = new Fuse(choices, fuseOptions);

  // Search for fuzzy matches
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
      score: matchResult.score,
      matchType: 'fuzzy'
    });

    // Only return matches above minimum confidence threshold
    if (matchResult.score >= 0.4) {
      return matchResult;
    }
  }

  appLogger.choiceMatching({
    ...context,
    bestMatch: undefined,
    score: undefined,
    matchType: 'none'
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
 * Maps spoken/written numbers in Portuguese to numeric values
 */
const numberWords: Record<string, number> = {
  // 1-10
  'um': 1, 'uma': 1, 'primeiro': 1, 'primeira': 1,
  'dois': 2, 'duas': 2, 'segundo': 2, 'segunda': 2,
  'tres': 3, 'três': 3, 'terceiro': 3, 'terceira': 3,
  'quatro': 4, 'quarto': 4, 'quarta': 4,
  'cinco': 5, 'quinto': 5, 'quinta': 5,
  'seis': 6, 'sexto': 6, 'sexta': 6,
  'sete': 7, 'setimo': 7, 'sétimo': 7, 'setima': 7, 'sétima': 7,
  'oito': 8, 'oitavo': 8, 'oitava': 8,
  'nove': 9, 'nono': 9, 'nona': 9,
  'dez': 10, 'decimo': 10, 'décimo': 10, 'decima': 10, 'décima': 10,

  // 11-20
  'onze': 11, 'décimo primeiro': 11, 'decimo primeiro': 11,
  'doze': 12, 'décimo segundo': 12, 'decimo segundo': 12,
  'treze': 13, 'décimo terceiro': 13, 'decimo terceiro': 13,
  'quatorze': 14, 'catorze': 14, 'décimo quarto': 14, 'decimo quarto': 14,
  'quinze': 15, 'décimo quinto': 15, 'decimo quinto': 15,
  'dezesseis': 16, 'dezasseis': 16, 'décimo sexto': 16, 'decimo sexto': 16,
  'dezessete': 17, 'dezassete': 17, 'décimo sétimo': 17, 'decimo setimo': 17,
  'dezoito': 18, 'décimo oitavo': 18, 'decimo oitavo': 18,
  'dezenove': 19, 'dezanove': 19, 'décimo nono': 19, 'decimo nono': 19,
  'vinte': 20, 'vigésimo': 20, 'vigesimo': 20,

  // 21-30
  'vinte e um': 21, 'vinte e uma': 21,
  'vinte e dois': 22, 'vinte e duas': 22,
  'vinte e tres': 23, 'vinte e três': 23,
  'vinte e quatro': 24,
  'vinte e cinco': 25,
  'vinte e seis': 26,
  'vinte e sete': 27,
  'vinte e oito': 28,
  'vinte e nove': 29,
  'trinta': 30, 'trigésimo': 30, 'trigesimo': 30,

  // 31-40
  'trinta e um': 31, 'trinta e uma': 31,
  'trinta e dois': 32, 'trinta e duas': 32,
  'trinta e tres': 33, 'trinta e três': 33,
  'trinta e quatro': 34,
  'trinta e cinco': 35,
  'trinta e seis': 36,
  'trinta e sete': 37,
  'trinta e oito': 38,
  'trinta e nove': 39,
  'quarenta': 40, 'quadragésimo': 40, 'quadragesimo': 40,

  // 41-50
  'quarenta e um': 41, 'quarenta e uma': 41,
  'quarenta e dois': 42, 'quarenta e duas': 42,
  'quarenta e tres': 43, 'quarenta e três': 43,
  'quarenta e quatro': 44,
  'quarenta e cinco': 45,
  'quarenta e seis': 46,
  'quarenta e sete': 47,
  'quarenta e oito': 48,
  'quarenta e nove': 49,
  'cinquenta': 50, 'quinquagésimo': 50, 'quinquagesimo': 50,

  // 51-60
  'cinquenta e um': 51, 'cinquenta e uma': 51,
  'cinquenta e dois': 52, 'cinquenta e duas': 52,
  'cinquenta e tres': 53, 'cinquenta e três': 53,
  'cinquenta e quatro': 54,
  'cinquenta e cinco': 55,
  'cinquenta e seis': 56,
  'cinquenta e sete': 57,
  'cinquenta e oito': 58,
  'cinquenta e nove': 59,
  'sessenta': 60, 'sexagésimo': 60, 'sexagesimo': 60,

  // 61-70
  'sessenta e um': 61, 'sessenta e uma': 61,
  'sessenta e dois': 62, 'sessenta e duas': 62,
  'sessenta e tres': 63, 'sessenta e três': 63,
  'sessenta e quatro': 64,
  'sessenta e cinco': 65,
  'sessenta e seis': 66,
  'sessenta e sete': 67,
  'sessenta e oito': 68,
  'sessenta e nove': 69,
  'setenta': 70, 'septuagésimo': 70, 'septuagesimo': 70,

  // 71-80
  'setenta e um': 71, 'setenta e uma': 71,
  'setenta e dois': 72, 'setenta e duas': 72,
  'setenta e tres': 73, 'setenta e três': 73,
  'setenta e quatro': 74,
  'setenta e cinco': 75,
  'setenta e seis': 76,
  'setenta e sete': 77,
  'setenta e oito': 78,
  'setenta e nove': 79,
  'oitenta': 80, 'octogésimo': 80, 'octogesimo': 80,

  // 81-90
  'oitenta e um': 81, 'oitenta e uma': 81,
  'oitenta e dois': 82, 'oitenta e duas': 82,
  'oitenta e tres': 83, 'oitenta e três': 83,
  'oitenta e quatro': 84,
  'oitenta e cinco': 85,
  'oitenta e seis': 86,
  'oitenta e sete': 87,
  'oitenta e oito': 88,
  'oitenta e nove': 89,
  'noventa': 90, 'nonagésimo': 90, 'nonagesimo': 90,

  // 91-100
  'noventa e um': 91, 'noventa e uma': 91,
  'noventa e dois': 92, 'noventa e duas': 92,
  'noventa e tres': 93, 'noventa e três': 93,
  'noventa e quatro': 94,
  'noventa e cinco': 95,
  'noventa e seis': 96,
  'noventa e sete': 97,
  'noventa e oito': 98,
  'noventa e nove': 99,
  'cem': 100, 'centésimo': 100, 'centesimo': 100
};

/**
 * Attempts to match numeric references (digits or spoken numbers)
 */
function findNumericMatch(
  cleanTranscription: string,
  choices: Array<{ id: string; content: string }>
): ChoiceMatchResult | null {
  // Check for digit patterns (e.g., "1", "opção 1", "número 2")
  const digitMatch = cleanTranscription.match(/\b(\d+)\b/);
  if (digitMatch) {
    const choiceNumber = parseInt(digitMatch[1], 10);
    if (choiceNumber >= 1 && choiceNumber <= choices.length) {
      return {
        id: choices[choiceNumber - 1].id,
        content: choices[choiceNumber - 1].content,
        score: 1.0
      };
    }
  }

  // Check for spoken numbers in Portuguese
  const words = cleanTranscription.split(/\s+/);
  for (const word of words) {
    const choiceNumber = numberWords[word];
    if (choiceNumber && choiceNumber >= 1 && choiceNumber <= choices.length) {
      return {
        id: choices[choiceNumber - 1].id,
        content: choices[choiceNumber - 1].content,
        score: 1.0
      };
    }
  }

  return null;
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