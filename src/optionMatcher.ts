import Fuse from "fuse.js";
import pino from "pino";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

export interface MatchResult {
  matched: boolean;
  selectedOption?: any;
  confidence: number;
  transcribedText: string;
  matchedText?: string;
}

export interface OptionItem {
  id: string;
  content: string;
}

export function matchTranscriptionToOption(
  transcription: string,
  options: OptionItem[],
  threshold: number = 0.6 // Minimum similarity score (0-1)
): MatchResult {
  if (!transcription || !options || options.length === 0) {
    return {
      matched: false,
      confidence: 0,
      transcribedText: transcription,
    };
  }

  // Clean and normalize the transcription
  const cleanTranscription = transcription.toLowerCase().trim();

  // Prepare options for Fuse.js
  const fuseOptions = {
    includeScore: true,
    threshold: 1 - threshold, // Fuse.js uses distance (lower is better), we use similarity
    keys: ["content", "normalizedContent"],
    minMatchCharLength: 2,
  };

  // Create search data with normalized content
  const searchData = options.map((option) => ({
    ...option,
    normalizedContent: normalizeText(option.content),
  }));

  const fuse = new Fuse(searchData, fuseOptions);

  // Try exact matches first (case insensitive)
  const exactMatch = searchData.find(
    (option) =>
      option.normalizedContent === normalizeText(cleanTranscription) ||
      option.content.toLowerCase() === cleanTranscription
  );

  if (exactMatch) {
    logger.info(
      {
        transcription: cleanTranscription,
        matchedOption: exactMatch.content,
        matchType: "exact",
      },
      "Found exact match for transcription"
    );

    return {
      matched: true,
      selectedOption: exactMatch,
      confidence: 1.0,
      transcribedText: transcription,
      matchedText: exactMatch.content,
    };
  }

  // Try fuzzy matching
  const results = fuse.search(cleanTranscription);

  if (results.length > 0 && results[0].score !== undefined) {
    const bestMatch = results[0];
    const confidence = 1 - (bestMatch.score ?? 0); // Convert distance to similarity

    logger.info(
      {
        transcription: cleanTranscription,
        matchedOption: bestMatch.item.content,
        confidence,
        threshold,
        matchType: "fuzzy",
      },
      "Fuzzy match result for transcription"
    );

    if (confidence >= threshold) {
      return {
        matched: true,
        selectedOption: bestMatch.item,
        confidence,
        transcribedText: transcription,
        matchedText: bestMatch.item.content,
      };
    }
  }

  // Try partial matches (contains)
  const partialMatch = searchData.find((option) => {
    const optionWords = option.normalizedContent.split(" ");
    const transcriptionWords = normalizeText(cleanTranscription).split(" ");

    // Check if any significant word from transcription is in the option
    return transcriptionWords.some(
      (word) =>
        word.length > 2 &&
        optionWords.some(
          (optionWord) => optionWord.includes(word) || word.includes(optionWord)
        )
    );
  });

  if (partialMatch) {
    logger.info(
      {
        transcription: cleanTranscription,
        matchedOption: partialMatch.content,
        matchType: "partial",
      },
      "Found partial match for transcription"
    );

    return {
      matched: true,
      selectedOption: partialMatch,
      confidence: 0.7, // Fixed confidence for partial matches
      transcribedText: transcription,
      matchedText: partialMatch.content,
    };
  }

  logger.info(
    {
      transcription: cleanTranscription,
      availableOptions: options.map((o) => o.content),
      threshold,
    },
    "No suitable match found for transcription"
  );

  return {
    matched: false,
    confidence: results[0] ? 1 - results[0].score! : 0,
    transcribedText: transcription,
  };
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD") // Decompose accented characters
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^\w\s]/g, " ") // Replace punctuation with spaces
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}
