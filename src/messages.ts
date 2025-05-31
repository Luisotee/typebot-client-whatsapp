export const MESSAGES = {
  en: {
    transcriptionDisabled:
      "Sorry, I can't process audio messages at the moment. Please send your message as text instead.",
    audioProcessingError:
      "Sorry, I couldn't process your audio message. Please try sending a text message.",
    generalError: "Sorry, something went wrong. Please try again.",
    chooseOption: "Choose an option:",
    listSectionTitle: "Choose an option",
  },
  pt: {
    transcriptionDisabled:
      "Desculpe, não consigo processar mensagens de áudio no momento. Por favor, envie sua mensagem como texto.",
    audioProcessingError:
      "Desculpe, não consegui processar sua mensagem de áudio. Tente enviar uma mensagem de texto.",
    generalError: "Desculpe, algo deu errado. Tente novamente.",
    chooseOption: "Escolha uma opção:",
    listSectionTitle: "Escolha uma opção",
  },
} as const;

export type SupportedLanguage = keyof typeof MESSAGES;

export function getMessage(
  key: keyof typeof MESSAGES.en,
  language: string = "en"
): string {
  const lang = language as SupportedLanguage;
  if (MESSAGES[lang] && MESSAGES[lang][key]) {
    return MESSAGES[lang][key];
  }
  // Fallback to English if language or key not found
  return MESSAGES.en[key];
}
