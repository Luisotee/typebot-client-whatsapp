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
    keys: ["content", "normalizedContent", "cleanContent"],
    minMatchCharLength: 2,
  };

  // Create search data with normalized and emoji-free content
  const searchData = options.map((option) => ({
    ...option,
    normalizedContent: normalizeText(option.content),
    cleanContent: removeEmojisAndNormalize(option.content),
  }));

  const fuse = new Fuse(searchData, fuseOptions);

  // Try exact matches first (case insensitive, with and without emojis)
  const exactMatch = searchData.find(
    (option) =>
      option.normalizedContent === normalizeText(cleanTranscription) ||
      option.cleanContent === removeEmojisAndNormalize(cleanTranscription) ||
      option.content.toLowerCase() === cleanTranscription
  );

  if (exactMatch) {
    logger.info(
      {
        transcription: cleanTranscription,
        matchedOption: exactMatch.content,
        cleanMatchedOption: exactMatch.cleanContent,
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

  // Try fuzzy matching (prioritize emoji-free content)
  const cleanTranscriptionForSearch = removeEmojisAndNormalize(cleanTranscription);
  const results = fuse.search(cleanTranscriptionForSearch);

  if (results.length > 0 && results[0].score !== undefined) {
    const bestMatch = results[0];
    const confidence = 1 - (bestMatch.score ?? 0); // Convert distance to similarity

    logger.info(
      {
        transcription: cleanTranscription,
        cleanTranscription: cleanTranscriptionForSearch,
        matchedOption: bestMatch.item.content,
        cleanMatchedOption: bestMatch.item.cleanContent,
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

  // Try partial matches (contains) - using emoji-free content
  const partialMatch = searchData.find((option) => {
    const optionWords = option.cleanContent.split(" ");
    const transcriptionWords = cleanTranscriptionForSearch.split(" ");

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
        cleanTranscription: cleanTranscriptionForSearch,
        matchedOption: partialMatch.content,
        cleanMatchedOption: partialMatch.cleanContent,
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
      cleanTranscription: cleanTranscriptionForSearch,
      availableOptions: options.map((o) => o.content),
      cleanAvailableOptions: searchData.map((o) => o.cleanContent),
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

function removeEmojisAndNormalize(text: string): string {
  return text
    .replace(/[\u{1F600}-\u{1F64F}]/gu, "") // Emoticons
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, "") // Misc Symbols and Pictographs
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, "") // Transport and Map
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, "") // Regional indicator symbols (flags)
    .replace(/[\u{2600}-\u{26FF}]/gu, "") // Miscellaneous Symbols
    .replace(/[\u{2700}-\u{27BF}]/gu, "") // Dingbats
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, "") // Supplemental Symbols and Pictographs
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, "") // Symbols and Pictographs Extended-A
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "") // Variation Selectors
    .replace(/[\u{200D}]/gu, "") // Zero Width Joiner (used in complex emojis)
    .toLowerCase()
    .normalize("NFD") // Decompose accented characters
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^\w\s]/g, " ") // Replace remaining punctuation with spaces
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}
