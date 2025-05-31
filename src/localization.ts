export const MESSAGES = {
  en: {
    transcriptionDisabled:
      "Sorry, I can't process audio messages at the moment. Please send your message as text instead.",
    audioProcessingError:
      "Sorry, I couldn't process your audio message. Please try sending a text message.",
    generalError: "Sorry, something went wrong. Please try again.",
    chooseOption: "Choose an option:",
    listSectionTitle: "Choose an option",
    audioOptionMatched: "I understood you said: '{{option}}'. Processing your choice...",
    audioOptionNotMatched:
      "I couldn't understand which option you meant. Please try again by saying one of the available options clearly, or tap on your choice.",
    noValidOptions: "No options available to choose from.",
  },
  pt: {
    transcriptionDisabled:
      "Desculpe, não consigo processar mensagens de áudio no momento. Por favor, envie sua mensagem como texto.",
    audioProcessingError:
      "Desculpe, não consegui processar sua mensagem de áudio. Tente enviar uma mensagem de texto.",
    generalError: "Desculpe, algo deu errado. Tente novamente.",
    chooseOption: "Escolha uma opção:",
    listSectionTitle: "Escolha uma opção",
    audioOptionMatched:
      "Entendi que você disse: '{{option}}'. Processando sua escolha...",
    audioOptionNotMatched:
      "Não consegui entender qual opção você quis dizer. Tente novamente falando uma das opções disponíveis claramente, ou toque na sua escolha.",
    noValidOptions: "Nenhuma opção disponível para escolher.",
  },
} as const;

export type SupportedLanguage = keyof typeof MESSAGES;

export function getMessage(
  key: keyof typeof MESSAGES.en,
  language: string = "en",
  replacements?: Record<string, string>
): string {
  const lang = language as SupportedLanguage;
  let message: string;

  if (MESSAGES[lang] && MESSAGES[lang][key]) {
    message = MESSAGES[lang][key];
  } else {
    // Fallback to English if language or key not found
    message = MESSAGES.en[key];
  }

  // Apply replacements if provided
  if (replacements) {
    Object.entries(replacements).forEach(([placeholder, value]) => {
      message = message.replace(new RegExp(`{{${placeholder}}}`, "g"), value);
    });
  }

  return message;
}
